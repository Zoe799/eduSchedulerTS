import { html, formatDate, formatTime, escapeHtml, renderPage } from "./shared";

export async function handleView(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
      // ========== 查看课表 ==========
      const dateStr =
        url.searchParams.get("date_str") || formatDate(new Date());

      // --------------------------------------------------
      // 1. Determine selected week
      // --------------------------------------------------

      const selectedDate = new Date(dateStr + "T12:00:00");

      // JS: Sunday = 0, Monday = 1
      const dayOfWeek = selectedDate.getDay();

      const monday = new Date(selectedDate);
      const diffToMonday =
        dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

      monday.setDate(
        selectedDate.getDate() + diffToMonday
      );

      const saturday = new Date(monday);
      saturday.setDate(monday.getDate() + 5);

      const weekStart = formatDate(monday);
      const weekEnd = formatDate(saturday);

      // --------------------------------------------------
      // 2. Build Monday-Friday structure
      // --------------------------------------------------

      const days: {
        date: Date;
        courses: any[];
      }[] = [];

      for (let i = 0; i < 6; i++) {
        const d = new Date(monday);

        d.setDate(monday.getDate() + i);

        days.push({
          date: d,
          courses: []
        });
      }

      // --------------------------------------------------
      // 3. Get schools
      // --------------------------------------------------

      const { results: schoolRows } =
        await env.edu_scheduler_db.prepare(`
          SELECT
            id,
            name,
            status,
            background_color,
            border_color
          FROM schools
          WHERE status IS NULL
            OR status <> 'hidden'
          ORDER BY name
        `).all();

      const schools = schoolRows as any[];
      const schoolColorMap = new Map<
        number,
        {
          background_color: string;
          border_color: string;
        }
      >();

      for (const school of schoolRows as any[]) {
        schoolColorMap.set(school.id, {
          background_color: school.background_color,
          border_color: school.border_color
        });
      }

      // --------------------------------------------------
      // 4. Get courses
      //
      // Courses are the base schedule.
      // We generate this week's classes from:
      //
      //   course.day_of_week
      //   course.start_date
      //   course.end_date
      // --------------------------------------------------

      const { results: courseRows } =
        await env.edu_scheduler_db.prepare(`
          SELECT
            c.id,
            c.school_id,
            s.name AS school_name,
            c.course_name,
            c.day_of_week,
            c.start_time,
            c.end_time,
            c.start_date,
            c.end_date,
            c.classroom,
            c.group_name,
            c.student_number
          FROM courses c
          JOIN schools s
            ON c.school_id = s.id
          WHERE
            (c.start_date IS NULL OR c.start_date <= ?)
            AND
            (c.end_date IS NULL OR c.end_date >= ?)
          ORDER BY
            c.day_of_week,
            c.start_time,
            s.name,
            c.course_name
        `)
          .bind(weekEnd, weekStart)
          .all();

      const courses = courseRows as any[];

      // --------------------------------------------------
      // 5. Get default course teachers
      //
      // course_teachers = default teachers
      // --------------------------------------------------

      const { results: courseTeacherRows } =
        await env.edu_scheduler_db.prepare(`
          SELECT
            course_id,
            teacher_id
          FROM course_teachers
          ORDER BY course_id, teacher_id
        `).all();

      const defaultTeacherMap: Record<number, number[]> = {};

      for (const row of courseTeacherRows as any[]) {
        const courseId = Number(row.course_id);

        if (!defaultTeacherMap[courseId]) {
          defaultTeacherMap[courseId] = [];
        }

        if (defaultTeacherMap[courseId].length < 4) {
          defaultTeacherMap[courseId].push(
            Number(row.teacher_id)
          );
        }
      }

      // --------------------------------------------------
      // 6. Get teacher names
      // --------------------------------------------------

      const { results: teacherRows } =
        await env.edu_scheduler_db.prepare(`
          SELECT
            id,
            name,
            status
          FROM teachers
          WHERE status IS NULL
            OR status <> 'hidden'
          ORDER BY name
        `).all();

      const teacherNameMap: Record<number, string> = {};

      for (const teacher of teacherRows as any[]) {
        teacherNameMap[Number(teacher.id)] =
          teacher.name;
      }

      // --------------------------------------------------
      // 7. Get weekly assignments
      //
      // IMPORTANT:
      //
      // We need assignments before/during this week
      // because an earlier assignment may be inherited.
      // --------------------------------------------------

      const { results: assignmentRows } =
        await env.edu_scheduler_db.prepare(`
          SELECT
            course_id,
            class_date,
            teacher_id
          FROM weekly_assignments
          WHERE class_date <= ?
          ORDER BY
            course_id,
            class_date DESC,
            teacher_id
        `)
          .bind(weekEnd)
          .all();

      const allWeeklyAssignments =
        assignmentRows as any[];

      // --------------------------------------------------
      // 8. Build direct weekly assignment map
      //
      // key:
      //   course_id + date
      //
      // Example:
      //   "12|2026-09-21"
      // --------------------------------------------------

      const weeklyAssignmentMap:
        Record<string, number[]> = {};

      for (const item of allWeeklyAssignments) {

        const courseId =
          Number(item.course_id);

        const classDate =
          item.class_date;

        const key =
          `${courseId}|${classDate}`;

        if (!weeklyAssignmentMap[key]) {
          weeklyAssignmentMap[key] = [];
        }

        // NULL teacher means unassigned.
        // Do not add it to the teacher list.
        if (item.teacher_id !== null) {

          if (
            weeklyAssignmentMap[key].length < 4
          ) {
            weeklyAssignmentMap[key].push(
              Number(item.teacher_id)
            );
          }
        }
      }

      // --------------------------------------------------
      // 9. Build inherited assignment map
      //
      // For each course + weekday:
      //
      // use the MOST RECENT previous assignment.
      // --------------------------------------------------

      const inheritedAssignmentMap:
        Record<string, number[]> = {};

      const inheritedAssignmentDate:
        Record<string, string> = {};

      for (const item of allWeeklyAssignments) {

        const courseId =
          Number(item.course_id);

        const classDate =
          item.class_date;

        // Only assignments before this week
        if (classDate >= weekStart) {
          continue;
        }

        const dateObject =
          new Date(classDate + "T12:00:00");

        // JS:
        // Sunday = 0
        // Monday = 1
        //
        // We want Monday = 0 ... Saturday = 5
        const weekday =
          (dateObject.getDay() + 6) % 7;

        const key =
          `${courseId}|${weekday}`;

        // First one is the newest because
        // SQL ORDER BY class_date DESC.
        if (!inheritedAssignmentDate[key]) {

          inheritedAssignmentDate[key] =
            classDate;

          inheritedAssignmentMap[key] = [];
        }

        // Only collect teachers from
        // that newest assignment date.
        if (
          classDate === inheritedAssignmentDate[key]
          &&
          item.teacher_id !== null
        ) {

          if (
            inheritedAssignmentMap[key].length < 4
          ) {
            inheritedAssignmentMap[key].push(
              Number(item.teacher_id)
            );
          }
        }
      }

      // --------------------------------------------------
      // 10. Get schedule exceptions
      //
      // Two types of exceptions:
      //
      // A. school-wide:
      //      course_id IS NULL
      //
      // B. course-specific:
      //      course_id IS NOT NULL
      //
      // If either matches a course/date,
      // that course does not appear.
      // --------------------------------------------------

      const { results: exceptionRows } =
        await env.edu_scheduler_db.prepare(`
          SELECT
            id,
            school_id,
            course_id,
            start_date,
            end_date,
            type,
            reason
          FROM schedule_exceptions
          WHERE start_date <= ?
            AND end_date >= ?
        `)
          .bind(weekEnd, weekStart)
          .all();

      const scheduleExceptions =
        exceptionRows as any[];

      // --------------------------------------------------
      // 11. Helper:
      // Check whether a course is cancelled
      // on a specific date.
      // --------------------------------------------------

      function isCourseException(
        course: any,
        dateString: string
      ): boolean {

        for (const exception of scheduleExceptions) {

          // Different school
          if (
            Number(exception.school_id)
            !== Number(course.school_id)
          ) {
            continue;
          }

          // Date outside exception range
          if (
            dateString < exception.start_date ||
            dateString > exception.end_date
          ) {
            continue;
          }

          // School-wide exception
          if (exception.course_id === null) {
            return true;
          }

          // Course-specific exception
          if (
            Number(exception.course_id)
            === Number(course.id)
          ) {
            return true;
          }
        }

        return false;
      }

      // --------------------------------------------------
      // 12. Build weekly schedule
      // --------------------------------------------------

      for (const course of courses) {

        const courseId =
          Number(course.id);

        const courseWeekday =
          Number(course.day_of_week);

        // day_of_week:
        // 1 = Monday
        // 2 = Tuesday
        // ...
        // 5 = Friday
        // 6 = Saturday

        if (
          courseWeekday < 1 ||
          courseWeekday > 6
        ) {
          continue;
        }

        const dayIndex =
          courseWeekday - 1;

        const day =
          days[dayIndex];

        const classDate =
          formatDate(day.date);

        // ------------------------------------------------
        // Skip if there is a schedule exception
        // ------------------------------------------------

        if (
          isCourseException(
            course,
            classDate
          )
        ) {
          continue;
        }

        // ------------------------------------------------
        // Determine teachers
        //
        // Priority:
        //
        // 1. Direct assignment for this date
        // 2. Most recent previous assignment
        // 3. Default course teachers
        // ------------------------------------------------

        const directKey =
          `${courseId}|${classDate}`;

        const inheritedKey =
          `${courseId}|${courseWeekday - 1}`;

        let teacherIds: number[] = [];

        let assignmentSource =
          "default";

        // 1. Direct assignment
        if (
          Object.prototype.hasOwnProperty.call(
            weeklyAssignmentMap,
            directKey
          )
        ) {

          teacherIds =
            weeklyAssignmentMap[directKey];

          assignmentSource =
            "direct";

        }

        // 2. Inherited assignment
        else if (
          Object.prototype.hasOwnProperty.call(
            inheritedAssignmentMap,
            inheritedKey
          )
        ) {

          teacherIds =
            inheritedAssignmentMap[inheritedKey];

          assignmentSource =
            "inherited";

        }

        // 3. Default course teachers
        else {

          teacherIds =
            defaultTeacherMap[courseId] || [];

          assignmentSource =
            "default";
        }

        // ------------------------------------------------
        // Convert teacher IDs to names
        // ------------------------------------------------

        const teacherNames =
          teacherIds
            .map(
              teacherId =>
                teacherNameMap[teacherId]
            )
            .filter(
              name => !!name
            );
        
        const schoolColors = schoolColorMap.get(Number(course.school_id));
        // ------------------------------------------------
        // Add course to day
        // ------------------------------------------------

        day.courses.push({

          school_name:
            course.school_name,

          school_background:
            schoolColors?.background_color || "#e3f2fd",

          school_border:
            schoolColors?.border_color || "#2196f3",

          course_name:
            course.course_name,

          start_time_display:
            formatTime(course.start_time),

          end_time_display:
            formatTime(course.end_time),

          classroom:
            course.classroom,

          group_name:
            course.group_name,

          student_number:
            course.student_number,

          teacher_names:
            teacherNames,

          assignment_source:
            assignmentSource
        });
      }

      // --------------------------------------------------
      // 13. Sort courses within each day
      // --------------------------------------------------

      for (const day of days) {
        day.courses.sort((a, b) => {
          // 1. School
          const schoolCompare =
            a.school_name.localeCompare(
              b.school_name
            );

          if (schoolCompare !== 0) {
            return schoolCompare;
          }

          // 2. Start time
          const timeCompare =
            a.start_time_display.localeCompare(
              b.start_time_display
            );

          if (timeCompare !== 0) {
            return timeCompare;
          }

          // 3. Course name
          return a.course_name.localeCompare(
            b.course_name
          );
        });
      }

      // --------------------------------------------------
      // 14. Render page
      // --------------------------------------------------

      return html(
        renderViewPage({
          weekStart,
          weekEnd,
          selectedDate: dateStr,
          days
        })
      );
}

// ========== 查看课表页面（替代 view.html） ==========

function renderViewPage(data: {
  weekStart: string;
  weekEnd: string;
  selectedDate: string;
  days: { date: Date; courses: any[] }[];
}): string {
  const daysHtml = data.days.map(day => {
    const dayName = day.date.toLocaleDateString("en-US", { weekday: "long" });
    const dayDate = `${String(day.date.getMonth() + 1).padStart(2, "0")}/${String(day.date.getDate()).padStart(2, "0")}`;

    const coursesHtml = day.courses.length > 0
      ? day.courses.map(course => `
          <div class="course-block view-course-block" style="--school-background: ${course.school_background}; --school-border: ${course.school_border};">
            <div class="course-school">${course.school_name}</div>
            <div class="course-name">${course.course_name}</div>
            <div class="course-time">${course.start_time_display} – ${course.end_time_display}</div>
            <div class="course-details">
              ${course.classroom ? `<span>📍 ${course.classroom}</span>` : ""}
              ${course.group_name ? `<span>👥 ${course.group_name}</span>` : ""}
              ${course.student_number !== null && course.student_number !== undefined ? `<span>👦 ${course.student_number} kids</span>` : ""}
            </div>
            ${course.teacher_names.length > 0
              ? `<div class="view-teachers"><span class="view-teacher-label">Teacher:</span> ${course.teacher_names.join(", ")}</div>`
              : `<div class="view-unassigned">Teacher: Unassigned</div>`}
            ${course.assignment_source === "inherited" ? `<div class="inherited-label">↳ Inherited</div>` : ""}
          </div>
        `).join("")
      : `<div class="empty-cell">—</div>`;

    return `
      <div class="day-column">
        <div class="day-header">
          <div class="day-name">${dayName}</div>
          <div class="day-date">${dayDate}</div>
        </div>
        <div class="day-courses">${coursesHtml}</div>
      </div>
    `;
  }).join("");

  const content = `
    <div class="container">
      <div class="schedule-header">
        <div>
          <h1>Weekly Schedule</h1>
          <div class="week-range">${data.weekStart} – ${data.weekEnd}</div>
        </div>
        <div class="schedule-controls">
          <div class="date-selector">
            <input type="date" id="date-picker" value="${data.selectedDate}">
            <button type="button" onclick="goToDate()">Go</button>
          </div>
          <div class="week-navigation">
            <button type="button" onclick="changeWeek(-7)">← Previous</button>
            <button type="button" onclick="goToday()">Today</button>
            <button type="button" onclick="changeWeek(7)">Next →</button>
          </div>
        </div>
      </div>
      <div class="weekly-columns view-weekly-columns">${daysHtml}</div>
    </div>
    <script>
      function changeWeek(days) {
        const current = new Date("${data.selectedDate}T12:00:00");
        current.setDate(current.getDate() + days);
        window.location.href = "/view?date_str=" + formatDate(current);
      }
      function goToday() {
        window.location.href = "/view?date_str=" + formatDate(new Date());
      }
      function goToDate() {
        const datePicker = document.getElementById("date-picker");
        if (datePicker.value) {
          window.location.href = "/view?date_str=" + datePicker.value;
        }
      }
      function formatDate(d) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
      }
    </script>
  `;

  return renderPage(content);
}

