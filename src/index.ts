export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const SCHOOL_COLOR_PALETTE = [
      {"background": "#EAF2FF", "border": "#5B8DEF"},
      {"background": "#EAF7EE", "border": "#55A96B"},
      {"background": "#FFF2E5", "border": "#E58A3A"},
      {"background": "#F3ECFF", "border": "#9566D8"},
      {"background": "#E8F7F7", "border": "#3FA6A6"},
      {"background": "#FFF0F2", "border": "#D96B7B"},
      {"background": "#FFF8DF", "border": "#D4A72C"},
      {"background": "#EEF0FF", "border": "#6978D8"},
      {"background": "#F1F1F1", "border": "#777777"},
      {"background": "#EAF5FF", "border": "#4C9BCF"},
      {"background": "#FDEDF7", "border": "#C85A9B"},
      {"background": "#EEF8E8", "border": "#76A84F"},
      {"background": "#FFF0E8", "border": "#D8784D"},
      {"background": "#E8F3FF", "border": "#3A78C2"},
      {"background": "#F0F8E8", "border": "#7AAE45"},
      {"background": "#FFF4E8", "border": "#E08B4F"},
      {"background": "#F2EEFF", "border": "#8064C7"},
      {"background": "#E8F8F4", "border": "#45A88B"},
      {"background": "#FFF0E6", "border": "#D66A3D"},
      {"background": "#EEF4FF", "border": "#527FC4"},
    ];

    // ========== 首页 ==========
    // ========== 首页重定向到课表 ==========
	if (url.pathname === "/") {
	return Response.redirect(url.origin + "/view", 302);
	}

    // ========== 查看课表 ==========
  if (url.pathname === "/view") {
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

    // ========== 教师列表 ==========
  if (url.pathname === "/teachers") {
    const { results: teacherRows } =
      await env.edu_scheduler_db.prepare(`
        SELECT
          id,
          name,
          status,
          work_days
        FROM teachers
        WHERE status IS NULL
          OR status <> 'hidden'
        ORDER BY name
      `).all();

    const teachers = teacherRows as any[];

    const { results: leaveRows } =
      await env.edu_scheduler_db.prepare(`
        SELECT
          id,
          teacher_id,
          start_date,
          end_date,
          note
        FROM teacher_leave
        ORDER BY start_date
      `).all();

    const leaveMap: Record<number, any[]> = {};

    for (const leave of leaveRows as any[]) {
      const teacherId = Number(leave.teacher_id);

      if (!leaveMap[teacherId]) {
        leaveMap[teacherId] = [];
      }

      leaveMap[teacherId].push(leave);
    }

    return html(
      renderTeacherListPage({
        teachers,
        leaveMap
      })
    );
  }

    // ========== POST删除老师（status='hidden'） ======
  if (
    url.pathname === "/delete-teacher" &&
    request.method === "POST"
  ) {
    const formData =
      await request.formData();

    const teacherId =
      Number(formData.get("teacher_id"));

    if (!teacherId) {
      return new Response(
        "Teacher ID is required.",
        { status: 400 }
      );
    }

    await env.edu_scheduler_db
      .prepare(`
        UPDATE teachers
        SET status = 'hidden'
        WHERE id = ?
      `)
      .bind(teacherId)
      .run();

    return Response.redirect(
      url.origin + "/teachers",
      303
    );
  }

    // ========== POST创建新老师 =========
  if (
    url.pathname === "/create-teacher" &&
    request.method === "POST"
  ) {

    const formData =
      await request.formData();

    const teacherName =
      String(
        formData.get("teacher_name") || ""
      ).trim();

    const workDays =
      String(
        formData.get("work_days") || ""
      ).trim();


    if (!teacherName) {
      return new Response(
        "Teacher name is required.",
        { status: 400 }
      );
    }


    if (!workDays) {
      return new Response(
        "Working days are required.",
        { status: 400 }
      );
    }


    await env.edu_scheduler_db
      .prepare(`
        INSERT INTO teachers (
          name,
          work_days
        )
        VALUES (?, ?)
      `)
      .bind(
        teacherName,
        workDays
      )
      .run();


    return Response.redirect(
      url.origin + "/teachers",
      303
    );
  }

  // ========== POST创建老师请假 ========
  if (
    url.pathname === "/create-teacher-leave" &&
    request.method === "POST"
  ) {
    const formData = await request.formData();

    const teacherIdValue =
      formData.get("teacher_id");

    const startDate =
      String(formData.get("start_date") || "").trim();

    const endDate =
      String(formData.get("end_date") || "").trim();

    const note =
      String(formData.get("note") || "").trim();

    if (!teacherIdValue) {
      return Response.json(
        {
          success: false,
          message: "Missing teacher ID."
        },
        { status: 400 }
      );
    }

    const teacherId =
      Number(teacherIdValue);

    if (!Number.isInteger(teacherId)) {
      return Response.json(
        {
          success: false,
          message: "Invalid teacher ID."
        },
        { status: 400 }
      );
    }

    if (!startDate || !endDate) {
      return Response.json(
        {
          success: false,
          message:
            "Start and end dates are required."
        },
        { status: 400 }
      );
    }

    if (endDate < startDate) {
      return Response.json(
        {
          success: false,
          message:
            "End date cannot be before start date."
        },
        { status: 400 }
      );
    }

    // Check teacher exists
    const teacher =
      await env.edu_scheduler_db
        .prepare(`
          SELECT id
          FROM teachers
          WHERE id = ?
        `)
        .bind(teacherId)
        .first();

    if (!teacher) {
      return Response.json(
        {
          success: false,
          message: "Teacher not found."
        },
        { status: 404 }
      );
    }

    // Insert leave
    const result =
      await env.edu_scheduler_db
        .prepare(`
          INSERT INTO teacher_leave
            (
              teacher_id,
              start_date,
              end_date,
              note
            )
          VALUES (?, ?, ?, ?)
        `)
        .bind(
          teacherId,
          startDate,
          endDate,
          note || null
        )
        .run();

    return Response.json({
      success: true,
      message:
        "Teacher leave added successfully.",
      leave_id: result.meta.last_row_id
    });
  }

    // ========= POST删除老师请假 ========
  if (
    url.pathname === "/delete-teacher-leave" &&
    request.method === "POST"
  ) {
    const formData = await request.formData();

    const leaveIdValue =
      formData.get("leave_id");

    if (!leaveIdValue) {
      return Response.json(
        {
          success: false,
          message: "Missing leave ID."
        },
        { status: 400 }
      );
    }

    const leaveId =
      Number(leaveIdValue);

    if (!Number.isInteger(leaveId)) {
      return Response.json(
        {
          success: false,
          message: "Invalid leave ID."
        },
        { status: 400 }
      );
    }

    // Check leave record exists
    const leave =
      await env.edu_scheduler_db
        .prepare(`
          SELECT id
          FROM teacher_leave
          WHERE id = ?
        `)
        .bind(leaveId)
        .first();

    if (!leave) {
      return Response.json(
        {
          success: false,
          message:
            "Leave record not found."
        },
        { status: 404 }
      );
    }

    // Delete leave
    await env.edu_scheduler_db
      .prepare(`
        DELETE FROM teacher_leave
        WHERE id = ?
      `)
      .bind(leaveId)
      .run();

    return Response.json({
      success: true,
      message:
        "Teacher leave deleted successfully."
    });
  }

    // ========= 更新老师工作日 ========
  if (
    url.pathname === "/update-teacher-workdays" &&
    request.method === "POST"
  ) {
    const formData = await request.formData();

    const teacherIdValue =
      formData.get("teacher_id");

    const workDaysValue =
      String(
        formData.get("work_days") || ""
      ).trim();

    // Validate teacher ID
    const teacherId =
      Number(teacherIdValue);

    if (!Number.isInteger(teacherId)) {
      return Response.json(
        {
          success: false,
          message: "Invalid teacher ID."
        },
        { status: 400 }
      );
    }

    // Convert:
    // "1,2,4,5"
    // ->
    // [1,2,4,5]

    let workdays: number[] = [];

    if (workDaysValue) {
      try {
        workdays =
          workDaysValue
            .split(",")
            .filter(day => day.trim() !== "")
            .map(day => Number(day.trim()));

      } catch {
        return Response.json(
          {
            success: false,
            message:
              "Invalid workday value."
          },
          { status: 400 }
        );
      }
    }

    // Validate workdays
    if (
      workdays.some(
        day =>
          !Number.isInteger(day) ||
          day < 1 ||
          day > 6
      )
    ) {
      return Response.json(
        {
          success: false,
          message:
            "Workdays must be between 1 and 6."
        },
        { status: 400 }
      );
    }

    // Remove duplicates and sort
    workdays =
      [...new Set(workdays)].sort(
        (a, b) => a - b
      );

    // Convert back to DB format
    // [1,2,4,5] -> "1,2,4,5"

    const normalizedWorkDays =
      workdays.join(",");

    // Check teacher exists
    const teacher =
      await env.edu_scheduler_db
        .prepare(`
          SELECT id
          FROM teachers
          WHERE id = ?
        `)
        .bind(teacherId)
        .first();

    if (!teacher) {
      return Response.json(
        {
          success: false,
          message:
            "Teacher not found."
        },
        { status: 404 }
      );
    }

    // Update working days
    await env.edu_scheduler_db
      .prepare(`
        UPDATE teachers
        SET work_days = ?
        WHERE id = ?
      `)
      .bind(
        normalizedWorkDays,
        teacherId
      )
      .run();

    return Response.json({
      success: true,
      message:
        "Working days updated successfully.",
      teacher_id: teacherId,
      workdays
    });
  }

    // ========= 查看老师课表 =========
  const teacherMatch = url.pathname.match(/^\/teachers\/(\d+)$/);

  if (teacherMatch) {

    const teacherId =
      Number(teacherMatch[1]);

    // =========================================================
    // 1. Selected date
    // =========================================================

    const dateParam =
      url.searchParams.get("date_str");

    let selectedDate = new Date();

    if (dateParam) {

      const parsed =
        new Date(dateParam + "T12:00:00");

      if (!isNaN(parsed.getTime())) {
        selectedDate = parsed;
      }
    }


    // =========================================================
    // 2. Calculate Monday - Saturday
    // =========================================================

    const dayOfWeek =
      selectedDate.getDay();

    const mondayOffset =
      dayOfWeek === 0
        ? -6
        : 1 - dayOfWeek;

    const monday =
      new Date(selectedDate);

    monday.setDate(
      selectedDate.getDate() + mondayOffset
    );

    const saturday =
      new Date(monday);

    saturday.setDate(
      monday.getDate() + 5
    );

    const weekStart =
      formatDate(monday);

    const weekEnd =
      formatDate(saturday);


    // =========================================================
    // 3. Get selected teacher
    // =========================================================

    const teacher =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            id,
            name,
            status,
            work_days
          FROM teachers
          WHERE id = ?
            AND (
              status IS NULL
              OR status <> 'hidden'
            )
        `)
        .bind(teacherId)
        .first();

    if (!teacher) {

      return Response.redirect(
        url.origin + "/teachers",
        303
      );
    }


    // =========================================================
    // 4. Get all active teachers
    // =========================================================

    const { results: teacherRows } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            id,
            name,
            status,
            work_days
          FROM teachers
          WHERE status IS NULL
            OR status <> 'hidden'
          ORDER BY name
        `)
        .all();

    const teachers =
      teacherRows as any[];


    // =========================================================
    // 5. Get courses
    //
    // Include only courses active during this week.
    // =========================================================

    const { results: courseRows } =
      await env.edu_scheduler_db
        .prepare(`
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
            c.student_number,
            s.background_color,
            s.border_color
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
        .bind(
          weekEnd,
          weekStart
        )
        .all();

    const courses =
      courseRows as any[];


    // =========================================================
    // 6. Default course teachers
    // =========================================================

    const { results: courseTeacherRows } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            course_id,
            teacher_id
          FROM course_teachers
        `)
        .all();

    const courseTeacherMap =
      new Map<number, number[]>();

    for (
      const row of courseTeacherRows as any[]
    ) {

      const courseId =
        Number(row.course_id);

      if (!courseTeacherMap.has(courseId)) {
        courseTeacherMap.set(
          courseId,
          []
        );
      }

      const teacherList =
        courseTeacherMap.get(courseId)!;

      if (
        row.teacher_id !== null &&
        teacherList.length < 4
      ) {
        teacherList.push(
          Number(row.teacher_id)
        );
      }
    }


    // =========================================================
    // 7. Weekly assignments
    //
    // Get all assignments up to weekEnd so we can inherit
    // from previous weeks.
    // =========================================================

    const { results: weeklyRows } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            id,
            course_id,
            class_date,
            teacher_id
          FROM weekly_assignments
          WHERE class_date <= ?
          ORDER BY
            class_date DESC,
            id DESC
        `)
        .bind(weekEnd)
        .all();

    const weeklyAssignments =
      weeklyRows as any[];


    // =========================================================
    // 8. Exact weekly assignment map
    // =========================================================

    const weeklyAssignmentMap =
      new Map<string, number[]>();

    const explicitAssignmentDates =
      new Set<string>();

    for (
      const item of weeklyAssignments
    ) {

      const key =
        `${item.course_id}_${item.class_date}`;

      if (
        !weeklyAssignmentMap.has(key)
      ) {
        weeklyAssignmentMap.set(
          key,
          []
        );
      }

      explicitAssignmentDates.add(key);

      if (
        item.teacher_id !== null
      ) {

        const teacherList =
          weeklyAssignmentMap.get(key)!;

        if (
          teacherList.length < 4
        ) {
          teacherList.push(
            Number(item.teacher_id)
          );
        }
      }
    }


    // =========================================================
    // 9. Inherited assignment map
    // =========================================================

    const inheritedAssignmentMap =
      new Map<string, number[]>();

    const inheritedAssignmentDate =
      new Map<string, string>();

    for (
      const item of weeklyAssignments
    ) {

      if (
        item.class_date >= weekStart
      ) {
        continue;
      }

      const itemDate =
        new Date(
          item.class_date + "T12:00:00"
        );

      const weekday =
        itemDate.getDay() === 0
          ? 6
          : itemDate.getDay() - 1;

      const key =
        `${item.course_id}_${weekday}`;

      if (
        inheritedAssignmentDate.has(key)
      ) {
        continue;
      }

      inheritedAssignmentDate.set(
        key,
        item.class_date
      );

      const teacherList: number[] = [];

      for (
        const other of weeklyAssignments
      ) {

        if (
          other.course_id === item.course_id &&
          other.class_date === item.class_date &&
          other.teacher_id !== null
        ) {

          if (
            teacherList.length < 4
          ) {
            teacherList.push(
              Number(other.teacher_id)
            );
          }
        }
      }

      inheritedAssignmentMap.set(
        key,
        teacherList
      );
    }


    // =========================================================
    // 10. Schedule exceptions
    // =========================================================

    const { results: exceptionRows } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            id,
            school_id,
            course_id,
            start_date,
            end_date
          FROM schedule_exceptions
          WHERE start_date <= ?
            AND end_date >= ?
        `)
        .bind(
          weekEnd,
          weekStart
        )
        .all();

    const exceptions =
      exceptionRows as any[];


    function isCourseException(
      course: any,
      dateString: string
    ): boolean {

      return exceptions.some(
        exception => {

          const sameSchool =
            Number(exception.school_id) ===
            Number(course.school_id);

          const sameCourse =
            exception.course_id === null ||
            Number(exception.course_id) ===
            Number(course.id);

          const inDateRange =
            dateString >=
              exception.start_date &&
            dateString <=
              exception.end_date;

          return (
            sameSchool &&
            sameCourse &&
            inDateRange
          );
        }
      );
    }


    // =========================================================
    // 11. Build teacher schedule
    // =========================================================

    const days: any[] = [];

    for (let i = 0; i < 6; i++) {

      const currentDate =
        new Date(monday);

      currentDate.setDate(
        monday.getDate() + i
      );

      const dateString =
        formatDate(currentDate);

      const weekday =
        i + 1;

      const dayCourses: any[] = [];

      for (
        const course of courses
      ) {

        if (
          Number(course.day_of_week) !==
          weekday
        ) {
          continue;
        }


        // -----------------------------------------------------
        // Determine effective teachers
        // -----------------------------------------------------

        const exactKey =
          `${course.id}_${dateString}`;

        const inheritedKey =
          `${course.id}_${weekday}`;

        let teacherIds: number[] = [];

        let assignmentSource =
          "default";


        if (
          weeklyAssignmentMap.has(exactKey)
        ) {

          teacherIds =
            weeklyAssignmentMap.get(
              exactKey
            ) || [];

          assignmentSource =
            "weekly";

        } else if (
          inheritedAssignmentMap.has(
            inheritedKey
          )
        ) {

          teacherIds =
            inheritedAssignmentMap.get(
              inheritedKey
            ) || [];

          assignmentSource =
            "inherited";

        } else {

          teacherIds =
            courseTeacherMap.get(
              Number(course.id)
            ) || [];

          assignmentSource =
            "default";
        }


        // -----------------------------------------------------
        // Is selected teacher assigned?
        // -----------------------------------------------------

        if (
          !teacherIds.includes(
            teacherId
          )
        ) {
          continue;
        }


        // -----------------------------------------------------
        // Schedule exception
        // -----------------------------------------------------

        if (
          isCourseException(
            course,
            dateString
          )
        ) {
          continue;
        }


        // -----------------------------------------------------
        // Course data
        // -----------------------------------------------------

        dayCourses.push({
          id: course.id,
          school_id: course.school_id,
          school_name: course.school_name,
          course_name: course.course_name,
          day_of_week: course.day_of_week,
          start_time_display:
            formatTime(course.start_time),
          end_time_display:
            formatTime(course.end_time),
          classroom: course.classroom,
          group_name: course.group_name,
          student_number:
            course.student_number,
          assignment_source:
            assignmentSource,
          school_background:
            course.background_color ||
            "#e3f2f2",
          school_border:
            course.border_color ||
            "#2196f3"
        });
      }


      // -------------------------------------------------------
      // Sort
      // -------------------------------------------------------

      dayCourses.sort(
        (a, b) => {

          const schoolCompare =
            a.school_name.localeCompare(
              b.school_name
            );

          if (
            schoolCompare !== 0
          ) {
            return schoolCompare;
          }

          const timeCompare =
            a.start_time_display.localeCompare(
              b.start_time_display
            );

          if (
            timeCompare !== 0
          ) {
            return timeCompare;
          }

          return a.course_name.localeCompare(
            b.course_name
          );
        }
      );


      days.push({
        date: currentDate,
        courses: dayCourses
      });
    }


    // =========================================================
    // 12. Render
    // =========================================================

    return html(
      renderTeacherSchedulePage({
        teacher,
        teachers,
        teacher_id: teacherId,
        days,
        week_dates: days.map(
          day => day.date
        ),
        week_start: monday,
        week_end: saturday,
        selected_date: selectedDate
      })
    );
  }


    // ======== 编辑 =============
  if (url.pathname === "/edit") {

    // --------------------------------------------------
    // 1. Determine selected week
    // --------------------------------------------------

    const dateParam = url.searchParams.get("date_str");

    let selectedDate = new Date();

    if (dateParam) {
      const parsed = new Date(dateParam + "T12:00:00");

      if (!isNaN(parsed.getTime())) {
        selectedDate = parsed;
      }
    }

    // Monday
    const dayOfWeek = selectedDate.getDay();

    const mondayOffset =
      dayOfWeek === 0
        ? -6
        : 1 - dayOfWeek;

    const weekStartDate = new Date(selectedDate);

    weekStartDate.setDate(
      selectedDate.getDate() + mondayOffset
    );

    // Monday -> Saturday
    const weekDates: Date[] = [];

    for (let i = 0; i < 6; i++) {
      const current = new Date(weekStartDate);

      current.setDate(
        weekStartDate.getDate() + i
      );

      weekDates.push(current);
    }

    const weekStart =
      formatDate(weekDates[0]);

    const weekEnd =
      formatDate(weekDates[5]);


    // --------------------------------------------------
    // 2. Schools
    // --------------------------------------------------

    const {
      results: schoolRows
    } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            id,
            name,
            status,
            background_color,
            border_color
          FROM schools
          ORDER BY name
        `)
        .all();

    const schools =
      schoolRows as any[];


    // --------------------------------------------------
    // School color map
    // --------------------------------------------------

    const schoolColorMap =
      new Map<
        number,
        {
          background_color: string;
          border_color: string;
        }
      >();

    for (const school of schools) {

      schoolColorMap.set(
        Number(school.id),
        {
          background_color:
            school.background_color,
          border_color:
            school.border_color
        }
      );
    }


    // --------------------------------------------------
    // 3. Courses
    // --------------------------------------------------

    const {
      results: courseRows
    } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            c.id,
            c.school_id,
            s.name AS school_name,
            s.background_color,
            s.border_color,
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
          ORDER BY
            s.name,
            c.day_of_week,
            c.start_time,
            c.course_name
        `)
        .all();

    const allCourses =
      courseRows as any[];


    // --------------------------------------------------
    // 4. Teachers
    // --------------------------------------------------

    const {
      results: teacherRows
    } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            id,
            name,
            status,
            work_days
          FROM teachers
          WHERE status IS NULL
            OR status <> 'hidden'
          ORDER BY name
        `)
        .all();

    const teachers =
      teacherRows as any[];


    // Teacher name map

    const teacherNameMap =
      new Map<number, string>();

    for (const teacher of teachers) {

      teacherNameMap.set(
        Number(teacher.id),
        teacher.name
      );
    }


    // --------------------------------------------------
    // 5. Default course teachers
    //
    // IMPORTANT:
    // course_teachers DOES NOT have slot.
    //
    // Teachers are simply stored in order and
    // assigned to T1 / T2 / T3 / T4.
    // --------------------------------------------------

    const {
      results: courseTeacherRows
    } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            course_id,
            teacher_id
          FROM course_teachers
          ORDER BY
            course_id,
            teacher_id
        `)
        .all();

    const defaultTeacherMap =
      new Map<
        number,
        (number | null)[]
      >();

    for (const row of courseTeacherRows as any[]) {

      const courseId =
        Number(row.course_id);

      if (!defaultTeacherMap.has(courseId)) {

        defaultTeacherMap.set(
          courseId,
          []
        );
      }

      const teacherList =
        defaultTeacherMap.get(courseId)!;

      if (
        row.teacher_id !== null &&
        teacherList.length < 4
      ) {

        teacherList.push(
          Number(row.teacher_id)
        );
      }
    }


    // --------------------------------------------------
    // 6. Weekly assignments
    //
    // Get all assignments up to the end of this week.
    // This allows previous assignments to be inherited.
    //
    // Teacher 18 is excluded to match the original
    // Python version.
    // --------------------------------------------------

    const {
      results: weeklyRows
    } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            course_id,
            class_date,
            teacher_id
          FROM weekly_assignments
          WHERE
            class_date <= ?
            AND
            (
              teacher_id IS NULL
              OR teacher_id <> ?
            )
          ORDER BY
            course_id,
            class_date DESC,
            teacher_id
        `)
        .bind(
          weekEnd,
          18
        )
        .all();

    const allWeeklyAssignments =
      weeklyRows as any[];


    // --------------------------------------------------
    // 7. Exact weekly assignments
    //
    // If a row exists for course + date,
    // it is an explicit override.
    //
    // teacher_id = NULL means explicitly unassigned.
    // --------------------------------------------------

    const weeklyAssignmentMap =
      new Map<
        string,
        (number | null)[]
      >();

    for (
      const item
      of allWeeklyAssignments
    ) {

      const key =
        `${item.course_id}_${item.class_date}`;

      if (
        !weeklyAssignmentMap.has(key)
      ) {

        weeklyAssignmentMap.set(
          key,
          []
        );
      }

      const teacherList =
        weeklyAssignmentMap.get(key)!;

      if (
        item.teacher_id !== null &&
        teacherList.length < 4
      ) {

        teacherList.push(
          Number(item.teacher_id)
        );
      }
    }


    // --------------------------------------------------
    // 8. Inherited assignments
    //
    // If there is no assignment for the current week,
    // use the most recent previous assignment change
    // for the same course + weekday.
    //
    // Python weekday:
    // Monday = 0
    // Tuesday = 1
    // ...
    // Saturday = 5
    // --------------------------------------------------

    const inheritedAssignmentMap =
      new Map<
        string,
        (number | null)[]
      >();

    const inheritedAssignmentDate =
      new Map<string, string>();

    for (
      const item
      of allWeeklyAssignments
    ) {

      if (
        item.class_date >= weekStart
      ) {
        continue;
      }

      const courseId =
        Number(item.course_id);

      const itemDate =
        new Date(
          item.class_date + "T12:00:00"
        );

      const jsDay =
        itemDate.getDay();

      const weekday =
        jsDay === 0
          ? 6
          : jsDay - 1;

      const key =
        `${courseId}_${weekday}`;

      // The query is ordered by date DESC,
      // so the first previous date we encounter
      // is the most recent assignment change.
      if (
        inheritedAssignmentDate.has(key)
      ) {
        continue;
      }

      inheritedAssignmentDate.set(
        key,
        item.class_date
      );

      const teacherList:
        (number | null)[] = [];

      for (
        const other
        of allWeeklyAssignments
      ) {

        if (
          Number(other.course_id) === courseId &&
          other.class_date === item.class_date &&
          other.teacher_id !== null
        ) {

          if (
            teacherList.length < 4
          ) {
            teacherList.push(
              Number(other.teacher_id)
            );
          }
        }
      }

      inheritedAssignmentMap.set(
        key,
        teacherList
      );
    }


    // --------------------------------------------------
    // 9. Schedule exceptions
    // --------------------------------------------------

    const {
      results: exceptionRows
    } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            id,
            school_id,
            course_id,
            start_date,
            end_date,
            type,
            reason
          FROM schedule_exceptions
          WHERE
            start_date <= ?
            AND
            end_date >= ?
          ORDER BY
            start_date,
            end_date,
            school_id,
            course_id
        `)
        .bind(
          weekEnd,
          weekStart
        )
        .all();

    const editCalendarEvents =
      exceptionRows as any[];


    // --------------------------------------------------
    // 10. Teacher leave
    // --------------------------------------------------

    const {
      results: leaveRows
    } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            teacher_id,
            start_date,
            end_date,
            note
          FROM teacher_leave
          WHERE
            start_date <= ?
            AND
            end_date >= ?
        `)
        .bind(
          weekEnd,
          weekStart
        )
        .all();

    const teacherLeaves =
      leaveRows as any[];


    // Teacher leave map

    const teacherLeaveMap =
      new Map<number, any[]>();

    for (
      const leave
      of teacherLeaves
    ) {

      const teacherId =
        Number(leave.teacher_id);

      if (
        !teacherLeaveMap.has(teacherId)
      ) {

        teacherLeaveMap.set(
          teacherId,
          []
        );
      }

      teacherLeaveMap
        .get(teacherId)!
        .push(leave);
    }


    // --------------------------------------------------
    // 11. Schedule exception helper
    // --------------------------------------------------

    function isCourseException(
      course: any,
      dateString: string
    ): boolean {

      return editCalendarEvents.some(
        (event: any) => {

          const sameSchool =
            Number(event.school_id) ===
            Number(course.school_id);

          const sameCourse =
            event.course_id === null ||
            Number(event.course_id) ===
              Number(course.id);

          const inDateRange =
            dateString >= event.start_date &&
            dateString <= event.end_date;

          return (
            sameSchool &&
            sameCourse &&
            inDateRange
          );
        }
      );
    }


    // --------------------------------------------------
    // 12. Build schedule days
    // --------------------------------------------------

    const days: any[] = [];

    // Keep same school order as school query

    const schoolOrder =
      new Map<number, number>();

    for (
      let i = 0;
      i < schools.length;
      i++
    ) {

      schoolOrder.set(
        Number(schools[i].id),
        i
      );
    }


    for (
      let dayIndex = 0;
      dayIndex < 6;
      dayIndex++
    ) {

      const currentDate =
        weekDates[dayIndex];

      const dateString =
        formatDate(currentDate);

      // Monday = 1 ... Saturday = 6
      const courseWeekday =
        dayIndex + 1;

      const dayCourses: any[] = [];


      // ------------------------------------------------
      // Find courses for this day
      // ------------------------------------------------

      for (
        const course
        of allCourses
      ) {

        if (
          Number(course.day_of_week) !==
          courseWeekday
        ) {
          continue;
        }


        // ----------------------------------------------
        // Course date range
        // ----------------------------------------------

        if (
          course.start_date !== null &&
          dateString < course.start_date
        ) {
          continue;
        }

        if (
          course.end_date !== null &&
          dateString > course.end_date
        ) {
          continue;
        }


        // ----------------------------------------------
        // Determine teachers
        // ----------------------------------------------

        const exactKey =
          `${course.id}_${dateString}`;

        let teacherIds:
          (number | null)[];

        let assignmentExists =
          false;

        let assignmentInherited =
          false;


        // Exact weekly assignment

        if (
          weeklyAssignmentMap.has(exactKey)
        ) {

          teacherIds =
            weeklyAssignmentMap.get(
              exactKey
            ) || [];

          assignmentExists = true;
          assignmentInherited = false;

        } else {

          // --------------------------------------------
          // Inherited assignment
          // --------------------------------------------

          const inheritedKey =
            `${course.id}_${dayIndex}`;

          if (
            inheritedAssignmentMap.has(
              inheritedKey
            )
          ) {

            teacherIds =
              inheritedAssignmentMap.get(
                inheritedKey
              ) || [];

            assignmentExists = false;
            assignmentInherited = true;

          } else {

            // ------------------------------------------
            // Default teachers
            // ------------------------------------------

            teacherIds =
              defaultTeacherMap.get(
                Number(course.id)
              ) || [];

            assignmentExists = false;
            assignmentInherited = false;
          }
        }


        // Maximum 4 teachers

        teacherIds =
          teacherIds.slice(0, 4);


        // Always keep 4 slots

        teacherIds =
          teacherIds.concat(
            Array(4 - teacherIds.length)
              .fill(null)
          );


        // ----------------------------------------------
        // School colors
        // ----------------------------------------------

        const schoolColors =
          schoolColorMap.get(
            Number(course.school_id)
          );


        // ----------------------------------------------
        // Schedule exceptions
        // ----------------------------------------------

        const isHoliday =
          isCourseException(
            course,
            dateString
          );


        // ----------------------------------------------
        // Teacher leave warnings
        // ----------------------------------------------

        const teacherLeaveWarnings:
          any[] = [];

        for (
          const teacherId
          of teacherIds
        ) {

          if (
            teacherId === null
          ) {
            continue;
          }

          const leaves =
            teacherLeaveMap.get(
              Number(teacherId)
            ) || [];

          for (
            const leave
            of leaves
          ) {

            if (
              leave.start_date <= dateString &&
              dateString <= leave.end_date
            ) {

              teacherLeaveWarnings.push({
                teacher_name:
                  teacherNameMap.get(
                    Number(teacherId)
                  ) ||
                  "Unknown teacher",

                note:
                  leave.note
              });
            }
          }
        }


        // ----------------------------------------------
        // Build course data
        // ----------------------------------------------

        const courseData: any = {

          id:
            Number(course.id),

          school_id:
            Number(course.school_id),

          school_name:
            course.school_name,

          course_name:
            course.course_name,

          day_of_week:
            Number(course.day_of_week),

          start_time:
            course.start_time,

          end_time:
            course.end_time,

          start_time_display:
            formatTime(
              course.start_time
            ),

          end_time_display:
            formatTime(
              course.end_time
            ),

          start_date:
            course.start_date,

          end_date:
            course.end_date,

          classroom:
            course.classroom,

          group_name:
            course.group_name,

          student_number:
            course.student_number,

          school_background:
            schoolColors?.background_color ||
            course.background_color ||
            "#e3f2f2",

          school_border:
            schoolColors?.border_color ||
            course.border_color ||
            "#2196f3",

          teacher_ids:
            teacherIds,

          assignment_exists:
            assignmentExists,

          assignment_inherited:
            assignmentInherited,

          calendar_events:
            editCalendarEvents.filter(
              (event: any) => {

                const sameSchool =
                  Number(event.school_id) ===
                  Number(course.school_id);

                const sameCourse =
                  event.course_id === null ||
                  Number(event.course_id) ===
                    Number(course.id);

                const inDateRange =
                  dateString >= event.start_date &&
                  dateString <= event.end_date;

                return (
                  sameSchool &&
                  sameCourse &&
                  inDateRange
                );
              }
            ),

          is_holiday:
            isHoliday,

          teacher_leave_warnings:
            teacherLeaveWarnings,

          teacher_conflicts:
            []
        };


        dayCourses.push(
          courseData
        );
      }


      // ------------------------------------------------
      // Sort:
      //
      // 1. School
      // 2. Time
      // 3. Course name
      // ------------------------------------------------

      dayCourses.sort(
        (a, b) => {

          const schoolA =
            schoolOrder.get(
              Number(a.school_id)
            ) ?? 999;

          const schoolB =
            schoolOrder.get(
              Number(b.school_id)
            ) ?? 999;

          if (
            schoolA !== schoolB
          ) {
            return schoolA - schoolB;
          }


          const timeCompare =
            a.start_time_display.localeCompare(
              b.start_time_display
            );

          if (
            timeCompare !== 0
          ) {
            return timeCompare;
          }


          return a.course_name.localeCompare(
            b.course_name
          );
        }
      );


      days.push({
        date: currentDate,
        courses: dayCourses
      });
    }


    // --------------------------------------------------
    // 13. Compute free teachers per day
    // --------------------------------------------------

    const busyByWeekday:
      Record<number, Set<number>> = {

        1: new Set(),
        2: new Set(),
        3: new Set(),
        4: new Set(),
        5: new Set(),
        6: new Set()
      };


    // ----------------------------------------------
    // Find teachers already assigned on each weekday
    // ----------------------------------------------

    for (
      const day
      of days
    ) {

      const weekday =
        day.date.getDay() === 0
          ? 7
          : day.date.getDay();

      // We only use Monday-Saturday
      if (
        weekday < 1 ||
        weekday > 6
      ) {
        continue;
      }

      for (
        const course
        of day.courses
      ) {

        // Holiday courses do not occupy teachers

        if (
          course.is_holiday
        ) {
          continue;
        }

        for (
          const teacherId
          of course.teacher_ids
        ) {

          if (
            teacherId !== null
          ) {

            busyByWeekday[weekday]
              .add(
                Number(teacherId)
              );
          }
        }
      }
    }


    // ----------------------------------------------
    // Attach free teachers
    // ----------------------------------------------

    for (
      const day
      of days
    ) {

      const weekday =
        day.date.getDay() === 0
          ? 7
          : day.date.getDay();

      const busy =
        busyByWeekday[weekday] ||
        new Set<number>();

      const freeTeachers:
        any[] = [];

      for (
        const teacher
        of teachers
      ) {

        const teacherId =
          Number(teacher.id);

        // Already teaching that day

        if (
          busy.has(teacherId)
        ) {
          continue;
        }


        // Working days

        const workDays =
          String(
            teacher.work_days || ""
          )
            .split(",")
            .map(
              (d: string) =>
                d.trim()
            )
            .filter(
              (d: string) =>
                d !== ""
            );


        if (
          workDays.length > 0 &&
          !workDays.includes(
            String(weekday)
          )
        ) {

          continue;
        }


        freeTeachers.push(
          teacher
        );
      }


      day.free_teachers =
        freeTeachers;
    }


    // --------------------------------------------------
    // 14. Teacher conflict detection
    // --------------------------------------------------

    const allDayCourses:
      {
        dayIndex: number;
        course: any;
      }[] = [];


    for (
      let dayIndex = 0;
      dayIndex < days.length;
      dayIndex++
    ) {

      const day =
        days[dayIndex];

      for (
        const course
        of day.courses
      ) {

        if (
          course.is_holiday
        ) {
          continue;
        }

        allDayCourses.push({
          dayIndex,
          course
        });
      }
    }


    // ----------------------------------------------
    // Compare every pair of courses
    // ----------------------------------------------

    for (
      let i = 0;
      i < allDayCourses.length;
      i++
    ) {

      const itemA =
        allDayCourses[i];

      const courseA =
        itemA.course;

      const dayA =
        itemA.dayIndex;


      for (
        let j = i + 1;
        j < allDayCourses.length;
        j++
      ) {

        const itemB =
          allDayCourses[j];

        const courseB =
          itemB.course;

        const dayB =
          itemB.dayIndex;


        // Different days

        if (
          dayA !== dayB
        ) {
          continue;
        }


        // --------------------------------------------
        // Time overlap
        // --------------------------------------------

        const startA =
          courseA.start_time_display;

        const endA =
          courseA.end_time_display;

        const startB =
          courseB.start_time_display;

        const endB =
          courseB.end_time_display;


        if (
          !(
            startA < endB &&
            startB < endA
          )
        ) {

          continue;
        }


        // --------------------------------------------
        // Teachers
        // --------------------------------------------

        const teachersA =
          courseA.teacher_ids
            .filter(
              (id: number | null) =>
                id !== null
            )
            .map(
              (id: number) =>
                Number(id)
            );

        const teachersB =
          courseB.teacher_ids
            .filter(
              (id: number | null) =>
                id !== null
            )
            .map(
              (id: number) =>
                Number(id)
            );


        // --------------------------------------------
        // Find common teachers
        // --------------------------------------------

        const conflicts =
          teachersA.filter(
            (teacherId: number) =>
              teachersB.includes(
                teacherId
              )
          );


        if (
          conflicts.length === 0
        ) {
          continue;
        }


        // --------------------------------------------
        // Add warning to both courses
        // --------------------------------------------

        for (
          const teacherId
          of conflicts
        ) {

          const teacherName =
            teacherNameMap.get(
              teacherId
            ) ||
            "Unknown teacher";


          courseA.teacher_conflicts.push({
            teacher_name:
              teacherName,

            course_name:
              courseB.course_name,

            start_time:
              startB,

            end_time:
              endB
          });


          courseB.teacher_conflicts.push({
            teacher_name:
              teacherName,

            course_name:
              courseA.course_name,

            start_time:
              startA,

            end_time:
              endA
          });
        }
      }
    }


    // --------------------------------------------------
    // 15. Render
    // --------------------------------------------------

    return html(
      renderEditPage({
        schools,
        teachers,
        days,
        calendarEvents:
          editCalendarEvents,
        weekStart,
        weekEnd,
        selectedDate:
          formatDate(selectedDate)
      })
    );
  }

    // ======== POST保存课程编辑 ========
  if (
    url.pathname === "/save-assignments" &&
    request.method === "POST"
  ) {
    const formData = await request.formData();
    console.log(
      "SAVE FORM:",
      [...formData.entries()]
    );

    // -----------------------------------------------------
    // Get week start
    // -----------------------------------------------------

    const weekStart =
      String(
        formData.get("week_start") || ""
      ).trim();

    if (!weekStart) {
      return new Response(
        "Missing week_start.",
        { status: 400 }
      );
    }

    // -----------------------------------------------------
    // Collect assignments
    //
    // Form field example:
    //
    // teacher_14_2026-09-21_1 = 2
    //
    // 14            = course_id
    // 2026-09-21    = class_date
    // 1             = teacher position
    // 2             = teacher_id
    //
    // The last number is ONLY used to identify
    // which teacher select was submitted.
    // It is NOT stored in weekly_assignments.
    // -----------------------------------------------------

    const assignments =
      new Map<
        string,
        {
          courseId: number;
          classDate: string;
          teacherIds: number[];
        }
      >();

    for (
      const [key, value]
      of formData.entries()
    ) {

      if (
        !key.startsWith("teacher_")
      ) {
        continue;
      }

      const parts =
        key.split("_");

      if (parts.length !== 4) {
        continue;
      }

      const courseId =
        Number(parts[1]);

      const classDate =
        parts[2];

      if (
        !Number.isInteger(courseId)
      ) {
        continue;
      }

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
          classDate
        )
      ) {
        continue;
      }

      // ---------------------------------------------------
      // Only save assignments for this week.
      // Monday -> Friday, same as original Python code.
      // ---------------------------------------------------

      const start =
        new Date(
          weekStart + "T12:00:00"
        );

      const current =
        new Date(
          classDate + "T12:00:00"
        );

      const end =
        new Date(start);

      end.setDate(
        end.getDate() + 4
      );

      if (
        current < start ||
        current > end
      ) {
        continue;
      }

      const keyName =
        `${courseId}_${classDate}`;

      if (
        !assignments.has(keyName)
      ) {
        assignments.set(
          keyName,
          {
            courseId,
            classDate,
            teacherIds: []
          }
        );
      }

      const assignment =
        assignments.get(keyName)!;

      const teacherValue =
        String(value || "").trim();

      // Empty select = no teacher
      if (!teacherValue) {
        continue;
      }

      const teacherId =
        Number(teacherValue);

      if (
        !Number.isInteger(teacherId)
      ) {
        continue;
      }

      // Don't store the same teacher twice
      if (
        !assignment.teacherIds.includes(
          teacherId
        )
      ) {
        assignment.teacherIds.push(
          teacherId
        );
      }
    }

    // -----------------------------------------------------
    // Save assignments
    // -----------------------------------------------------

    for (
      const assignment
      of assignments.values()
    ) {

      const {
        courseId,
        classDate,
        teacherIds
      } = assignment;

      // ---------------------------------------------------
      // Delete the existing assignment for this
      // course + effective date.
      // ---------------------------------------------------

      await env.edu_scheduler_db
        .prepare(`
          DELETE FROM weekly_assignments
          WHERE course_id = ?
            AND class_date = ?
        `)
        .bind(
          courseId,
          classDate
        )
        .run();

      // ---------------------------------------------------
      // No teacher assigned
      // ---------------------------------------------------

      if (
        teacherIds.length === 0
      ) {

        await env.edu_scheduler_db
          .prepare(`
            INSERT INTO weekly_assignments (
              course_id,
              class_date,
              teacher_id,
              note
            )
            VALUES (?, ?, NULL, NULL)
          `)
          .bind(
            courseId,
            classDate
          )
          .run();

        continue;
      }

      // ---------------------------------------------------
      // Insert teachers
      // ---------------------------------------------------

      for (
        const teacherId
        of teacherIds
      ) {

        await env.edu_scheduler_db
          .prepare(`
            INSERT INTO weekly_assignments (
              course_id,
              class_date,
              teacher_id,
              note
            )
            VALUES (?, ?, ?, NULL)
          `)
          .bind(
            courseId,
            classDate,
            teacherId
          )
          .run();
      }
    }

    // -----------------------------------------------------
    // Return to the same week
    // -----------------------------------------------------

    return Response.redirect(
      url.origin +
        "/edit?date_str=" +
        encodeURIComponent(
          weekStart
        ),
      303
    );
  }

    // ======== POST创建假期 ==========
  if (
    url.pathname === "/create-schedule-exception" &&
    request.method === "POST"
  ) {

    const formData =
      await request.formData();

    const schoolIdValue =
      String(
        formData.get("school_id") || ""
      ).trim();

    const scope =
      String(
        formData.get("scope") || "school"
      ).trim();

    const courseIdValue =
      String(
        formData.get("course_id") || ""
      ).trim();

    const typeValue =
      String(
        formData.get("type") || "holiday"
      ).trim();

    const startDate =
      String(
        formData.get("start_date") || ""
      ).trim();

    const endDate =
      String(
        formData.get("end_date") || ""
      ).trim();

    const reason =
      String(
        formData.get("reason") || ""
      ).trim();


    // --------------------------------------------------
    // Basic validation
    // --------------------------------------------------

    if (
      !schoolIdValue ||
      !startDate ||
      !endDate
    ) {

      return Response.redirect(
        url.origin + "/edit",
        303
      );
    }


    const schoolId =
      Number(schoolIdValue);

    if (
      !Number.isInteger(schoolId)
    ) {

      return Response.redirect(
        url.origin + "/edit",
        303
      );
    }


    // --------------------------------------------------
    // Start date cannot be after end date
    // --------------------------------------------------

    if (
      startDate > endDate
    ) {

      return Response.redirect(
        url.origin +
          "/edit?date_str=" +
          encodeURIComponent(
            startDate
          ),
        303
      );
    }


    // --------------------------------------------------
    // Specific course
    // --------------------------------------------------

    let courseId:
      number | null = null;

    if (
      scope === "course"
    ) {

      if (
        !courseIdValue
      ) {

        return Response.redirect(
          url.origin +
            "/edit?date_str=" +
            encodeURIComponent(
              startDate
            ),
          303
        );
      }

      courseId =
        Number(courseIdValue);

      if (
        !Number.isInteger(courseId)
      ) {

        return Response.redirect(
          url.origin +
            "/edit?date_str=" +
            encodeURIComponent(
              startDate
            ),
          303
        );
      }
    }


    // --------------------------------------------------
    // Database
    // --------------------------------------------------

    await env.edu_scheduler_db
      .prepare(`
        INSERT INTO schedule_exceptions (
          school_id,
          course_id,
          start_date,
          end_date,
          type,
          reason
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        schoolId,
        courseId,
        startDate,
        endDate,
        typeValue,
        reason || null
      )
      .run();


    // --------------------------------------------------
    // Return to selected week
    // --------------------------------------------------

    return Response.redirect(
      url.origin +
        "/edit?date_str=" +
        encodeURIComponent(
          startDate
        ),
      303
    );
  }

    // ======== POST删除假期 ==========
  if (
    url.pathname === "/delete-schedule-exception" &&
    request.method === "POST"
  ) {

    const formData =
      await request.formData();

    const eventIdValue =
      String(
        formData.get("event_id") || ""
      ).trim();

    const weekStart =
      String(
        formData.get("week_start") || ""
      ).trim();


    // --------------------------------------------------
    // Basic validation
    // --------------------------------------------------

    if (
      !eventIdValue
    ) {

      return Response.redirect(
        url.origin + "/edit",
        303
      );
    }


    const eventId =
      Number(eventIdValue);

    if (
      !Number.isInteger(eventId)
    ) {

      return Response.redirect(
        url.origin + "/edit",
        303
      );
    }


    // --------------------------------------------------
    // Database
    // --------------------------------------------------

    const result =
      await env.edu_scheduler_db
        .prepare(`
          DELETE FROM schedule_exceptions
          WHERE id = ?
        `)
        .bind(eventId)
        .run();


    console.log(
      `[DELETE SCHEDULE EXCEPTION] ` +
      `event_id=${eventId}, ` +
      `deleted_rows=${result.meta.changes}`
    );


    // --------------------------------------------------
    // Return to selected week
    // --------------------------------------------------

    if (
      weekStart
    ) {

      return Response.redirect(
        url.origin +
          "/edit?date_str=" +
          encodeURIComponent(
            weekStart
          ),
        303
      );
    }


    return Response.redirect(
      url.origin + "/edit",
      303
    );
  }

    // ======== POST create course ======
  if (
    url.pathname === "/create-course" &&
    request.method === "POST"
  ) {

    const formData =
      await request.formData();

    const schoolIdValue =
      String(
        formData.get("school_id") || ""
      ).trim();

    const courseName =
      String(
        formData.get("course_name") || ""
      ).trim();

    const dayOfWeekValue =
      String(
        formData.get("day_of_week") || ""
      ).trim();

    const startTime =
      String(
        formData.get("start_time") || ""
      ).trim();

    const endTime =
      String(
        formData.get("end_time") || ""
      ).trim();

    let startDate =
      String(
        formData.get("start_date") || ""
      ).trim();

    let endDate =
      String(
        formData.get("end_date") || ""
      ).trim();

    const classroom =
      String(
        formData.get("classroom") || ""
      ).trim();

    const groupName =
      String(
        formData.get("group_name") || ""
      ).trim();

    const studentNumberValue =
      String(
        formData.get("student_number") || ""
      ).trim();


    // -----------------------------------------------------
    // Validate school
    // -----------------------------------------------------

    const schoolId =
      Number(schoolIdValue);

    if (
      !Number.isInteger(schoolId)
    ) {

      return Response.json({
        success: false,
        message: "Please select a school."
      });
    }


    // -----------------------------------------------------
    // Validate course name
    // -----------------------------------------------------

    if (!courseName) {

      return Response.json({
        success: false,
        message: "Course name cannot be empty."
      });
    }


    // -----------------------------------------------------
    // Validate day
    // -----------------------------------------------------

    const dayOfWeek =
      Number(dayOfWeekValue);

    if (
      !Number.isInteger(dayOfWeek)
    ) {

      return Response.json({
        success: false,
        message: "Invalid day."
      });
    }

    if (
      dayOfWeek < 1 ||
      dayOfWeek > 6
    ) {

      return Response.json({
        success: false,
        message:
          "Day must be Monday to Saturday."
      });
    }


    // -----------------------------------------------------
    // Validate time
    // -----------------------------------------------------

    if (
      !startTime ||
      !endTime
    ) {

      return Response.json({
        success: false,
        message:
          "Start time and end time are required."
      });
    }

    if (
      endTime <= startTime
    ) {

      return Response.json({
        success: false,
        message:
          "End time must be after start time."
      });
    }


    // -----------------------------------------------------
    // Validate date
    // -----------------------------------------------------

    if (!startDate) {
      startDate = "";
    }

    if (!endDate) {
      endDate = "";
    }

    if (
      startDate &&
      endDate &&
      endDate < startDate
    ) {

      return Response.json({
        success: false,
        message:
          "End date must be after start date."
      });
    }


    // -----------------------------------------------------
    // Validate students
    // -----------------------------------------------------

    let studentNumber:
      number | null = null;

    if (
      studentNumberValue !== ""
    ) {

      const parsed =
        Number(studentNumberValue);

      if (
        !Number.isInteger(parsed) ||
        parsed < 0
      ) {
        return Response.json({
          success: false,
          message:
            "Student number must be a non-negative integer"
        });
      }

      studentNumber = parsed;
    }


    // -----------------------------------------------------
    // Check school exists
    // -----------------------------------------------------

    const school =
      await env.edu_scheduler_db
        .prepare(`
          SELECT id
          FROM schools
          WHERE id = ?
        `)
        .bind(schoolId)
        .first();

    if (!school) {

      return Response.json({
        success: false,
        message: "School not found."
      });
    }


    // -----------------------------------------------------
    // Create course
    // -----------------------------------------------------

    const result =
      await env.edu_scheduler_db
        .prepare(`
          INSERT INTO courses (
            school_id,
            course_name,
            day_of_week,
            start_time,
            end_time,
            start_date,
            end_date,
            classroom,
            group_name,
            student_number
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          schoolId,
          courseName,
          dayOfWeek,
          startTime,
          endTime,
          startDate || null,
          endDate || null,
          classroom || null,
          groupName || null,
          studentNumber
        )
        .run();

    return Response.json({
      success: true,
      message: "Course created successfully.",
      course_id: result.meta.last_row_id
    });
  }

  // =========================================================
  // POST Create School
  // =========================================================

  if (
    url.pathname === "/create-school" &&
    request.method === "POST"
  ) {

    const formData =
      await request.formData();

    const schoolName =
      String(
        formData.get("name") || ""
      ).trim();


    // -------------------------------------------------
    // Validate school name
    // -------------------------------------------------

    if (!schoolName) {

      return Response.json({
        success: false,
        message:
          "School name cannot be empty."
      });
    }


    // -------------------------------------------------
    // Check if school already exists
    // -------------------------------------------------

    const existingSchool =
      await env.edu_scheduler_db
        .prepare(`
          SELECT id
          FROM schools
          WHERE name = ?
        `)
        .bind(schoolName)
        .first();

    if (existingSchool) {

      return Response.json({
        success: false,
        message:
          "This school already exists."
      });
    }


    // -------------------------------------------------
    // Get existing school colors
    // -------------------------------------------------

    const {
      results: usedColors
    } =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            background_color,
            border_color
          FROM schools
        `)
        .all();


    const usedColorPairs =
      new Set(
        (usedColors as any[]).map(
          row =>
            `${row.background_color}|${row.border_color}`
        )
      );


    // -------------------------------------------------
    // Select a color
    //
    // First use an unused color.
    // If all colors are already used,
    // reuse colors in a rotating order.
    // -------------------------------------------------

    let selectedColor:
      any = null;


    // Try unused color first

    for (
      const color
      of SCHOOL_COLOR_PALETTE
    ) {

      const colorPair =
        `${color.background}|${color.border}`;

      if (
        !usedColorPairs.has(
          colorPair
        )
      ) {

        selectedColor =
          color;

        break;
      }
    }


    // Reuse palette cyclically

    if (
      selectedColor === null
    ) {

      const colorIndex =
        usedColors.length %
        SCHOOL_COLOR_PALETTE.length;

      selectedColor =
        SCHOOL_COLOR_PALETTE[
          colorIndex
        ];
    }


    // -------------------------------------------------
    // Create school
    // -------------------------------------------------

    const result =
      await env.edu_scheduler_db
        .prepare(`
          INSERT INTO schools (
            name,
            background_color,
            border_color
          )
          VALUES (?, ?, ?)
        `)
        .bind(
          schoolName,
          selectedColor.background,
          selectedColor.border
        )
        .run();


    return Response.json({
      success: true,
      message:
        "School added successfully.",
      school_id:
        result.meta.last_row_id,
      school_name:
        schoolName
    });
  }

  // =========================================================
  // Update Course
  // =========================================================

  if (
    url.pathname === "/update-course" &&
    request.method === "POST"
  ) {

    const formData =
      await request.formData();

    const courseIdValue =
      String(
        formData.get("course_id") || ""
      ).trim();


    // -----------------------------------------------------
    // Validate course ID
    // -----------------------------------------------------

    if (!courseIdValue) {

      return Response.json({
        success: false,
        message: "Missing course ID"
      });
    }

    const courseId =
      Number(courseIdValue);

    if (
      !Number.isInteger(courseId)
    ) {

      return Response.json({
        success: false,
        message: "Invalid course ID"
      });
    }


    const courseName =
      String(
        formData.get("course_name") || ""
      ).trim();

    const startTime =
      String(
        formData.get("start_time") || ""
      ).trim();

    const endTime =
      String(
        formData.get("end_time") || ""
      ).trim();

    let startDate =
      String(
        formData.get("start_date") || ""
      ).trim();

    let endDate =
      String(
        formData.get("end_date") || ""
      ).trim();

    const classroom =
      String(
        formData.get("classroom") || ""
      ).trim();

    const groupName =
      String(
        formData.get("group_name") || ""
      ).trim();


    // -----------------------------------------------------
    // Validate course name
    // -----------------------------------------------------

    if (!courseName) {

      return Response.json({
        success: false,
        message:
          "Course name cannot be empty"
      });
    }


    // -----------------------------------------------------
    // Validate time
    // -----------------------------------------------------

    if (
      !startTime ||
      !endTime
    ) {

      return Response.json({
        success: false,
        message:
          "Start time and end time are required"
      });
    }


    if (
      endTime <= startTime
    ) {

      return Response.json({
        success: false,
        message:
          "End time must be after start time"
      });
    }


    // -----------------------------------------------------
    // Validate date
    // -----------------------------------------------------

    if (!startDate) {
      startDate = "";
    }

    if (!endDate) {
      endDate = "";
    }

    if (
      startDate &&
      endDate &&
      endDate < startDate
    ) {

      return Response.json({
        success: false,
        message:
          "End date must be after start date"
      });
    }


    // -----------------------------------------------------
    // Validate students
    // -----------------------------------------------------
    const studentNumberValue =
      String(
        formData.get("student_number") || ""
      ).trim();

    let studentNumber: number | null = null;

    if (studentNumberValue !== "") {

      const parsed =
        Number(studentNumberValue);

      if (
        !Number.isInteger(parsed) ||
        parsed < 0
      ) {
        return Response.json({
          success: false,
          message:
            "Student number must be a non-negative integer"
        });
      }

      studentNumber = parsed;
    }

    // -----------------------------------------------------
    // Check course exists
    // -----------------------------------------------------

    const course =
      await env.edu_scheduler_db
        .prepare(`
          SELECT id
          FROM courses
          WHERE id = ?
        `)
        .bind(courseId)
        .first();

    if (!course) {

      return Response.json({
        success: false,
        message:
          "Course not found"
      });
    }


    // -----------------------------------------------------
    // Update recurring course
    // -----------------------------------------------------

    await env.edu_scheduler_db
      .prepare(`
        UPDATE courses
        SET
          course_name = ?,
          start_time = ?,
          end_time = ?,
          classroom = ?,
          group_name = ?,
          student_number = ?,
          start_date = ?,
          end_date = ?
        WHERE id = ?
      `)
      .bind(
        courseName,
        startTime,
        endTime,
        classroom || null,
        groupName || null,
        studentNumber,
        startDate || null,
        endDate || null,
        courseId
      )
      .run();


    return Response.json({
      success: true,
      message:
        "Course updated successfully"
    });
  }

  // =========================================================
  // Delete Course
  // =========================================================

  if (
    url.pathname === "/delete-course" &&
    request.method === "POST"
  ) {

    const formData =
      await request.formData();

    const courseIdValue =
      String(
        formData.get("course_id") || ""
      ).trim();

    // -------------------------------------------------------
    // Validate course ID
    // -------------------------------------------------------

    if (!courseIdValue) {

      return Response.json({
        success: false,
        message: "Missing course ID"
      });
    }

    const courseId =
      Number(courseIdValue);

    if (
      !Number.isInteger(courseId)
    ) {

      return Response.json({
        success: false,
        message: "Invalid course ID"
      });
    }

    // -------------------------------------------------------
    // Check course exists
    // -------------------------------------------------------

    const course =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            id,
            course_name
          FROM courses
          WHERE id = ?
        `)
        .bind(courseId)
        .first();

    if (!course) {

      return Response.json({
        success: false,
        message: "Course not found"
      });
    }

    // -------------------------------------------------------
    // Delete course
    // -------------------------------------------------------

    const result =
      await env.edu_scheduler_db
        .prepare(`
          DELETE FROM courses
          WHERE id = ?
        `)
        .bind(courseId)
        .run();

    console.log(
      `[DELETE COURSE] ` +
      `course_id=${courseId}, ` +
      `deleted_rows=${result.meta.changes}`
    );

    if (
      !result.meta.changes ||
      result.meta.changes < 1
    ) {

      return Response.json({
        success: false,
        message: "Course was not deleted"
      });
    }

    return Response.json({
      success: true,
      message:
        "Course deleted successfully"
    });
  }

  // =========================================================
  // Update School
  // =========================================================

  if (
    url.pathname === "/manage-schools" &&
    request.method === "GET"
  ) {

    const result =
      await env.edu_scheduler_db
        .prepare(`
          SELECT
            id,
            name,
            status,
            background_color,
            border_color
          FROM schools
          ORDER BY name
        `)
        .all();

    return Response.json({
      success: true,
      schools: result.results
    });
  }

  // =========================================================
  // Update School
  // =========================================================

  if (
    url.pathname === "/update-school" &&
    request.method === "POST"
  ) {

    const formData =
      await request.formData();

    const schoolIdValue =
      String(
        formData.get("school_id") || ""
      ).trim();

    const status =
      String(
        formData.get("status") || "active"
      ).trim();

    const backgroundColor =
      String(
        formData.get("background_color") || ""
      ).trim();

    const borderColor =
      String(
        formData.get("border_color") || ""
      ).trim();

    // -------------------------------------------------------
    // Validate school ID
    // -------------------------------------------------------

    if (!schoolIdValue) {

      return Response.json({
        success: false,
        message: "Missing school ID"
      });

    }

    const schoolId =
      Number(schoolIdValue);

    if (!Number.isInteger(schoolId)) {

      return Response.json({
        success: false,
        message: "Invalid school ID"
      });

    }

    // -------------------------------------------------------
    // Validate status
    // -------------------------------------------------------

    if (
      status !== "active" &&
      status !== "hidden"
    ) {

      return Response.json({
        success: false,
        message: "Invalid school status"
      });

    }

    // -------------------------------------------------------
    // Validate colors
    // -------------------------------------------------------

    const colorPattern =
      /^#[0-9A-Fa-f]{6}$/;

    if (
      !colorPattern.test(backgroundColor) ||
      !colorPattern.test(borderColor)
    ) {

      return Response.json({
        success: false,
        message: "Invalid school color"
      });

    }

    // -------------------------------------------------------
    // Check school exists
    // -------------------------------------------------------

    const school =
      await env.edu_scheduler_db
        .prepare(`
          SELECT id
          FROM schools
          WHERE id = ?
        `)
        .bind(schoolId)
        .first();

    if (!school) {

      return Response.json({
        success: false,
        message: "School not found"
      });

    }

    // -------------------------------------------------------
    // Update school
    // -------------------------------------------------------

    const result =
      await env.edu_scheduler_db
        .prepare(`
          UPDATE schools
          SET
            status = ?,
            background_color = ?,
            border_color = ?
          WHERE id = ?
        `)
        .bind(
          status,
          backgroundColor,
          borderColor,
          schoolId
        )
        .run();

    console.log(
      `[UPDATE SCHOOL] ` +
      `school_id=${schoolId}, ` +
      `status=${status}, ` +
      `background_color=${backgroundColor}, ` +
      `border_color=${borderColor}, ` +
      `updated_rows=${result.meta.changes}`
    );

    return Response.json({
      success: true,
      message: "School updated successfully"
    });

  }

    // 其他路径交给静态资源
    return env.ASSETS.fetch(request);
  }
};

// ========== 工具函数 ==========

function html(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(t: string): string {
  return t ? t.substring(0, 5) : "";
}

function escapeHtml(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeJsString(value: any): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

// ========== 公共页面骨架（替代 base.html） ==========

function renderPage(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EduScheduler</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="topbar">
  <div class="logo">EduScheduler</div>
  <nav class="main-nav">
    <a href="/edit">Edit Schedule</a>
    <a href="/view">View Schedule</a>
    <a href="/teachers">Teacher Schedule</a>
  </nav>
</header>
<main>
  ${content}
</main>
</body>
</html>`;
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

// ========== 查看教师列表 （teacher_list.html） =======
function renderTeacherListPage(data: {
  teachers: any[];
  leaveMap: Record<number, any[]>;
}): string {

  const { teachers, leaveMap } = data;

  const teacherCards = teachers.length
    ? teachers.map(teacher => {

        const leaves = leaveMap[Number(teacher.id)] || [];

        const workDays = teacher.work_days
          ? String(teacher.work_days)
              .split(",")
              .map((d: string) => d.trim())
          : [];

        return `
          <div
            class="teacher-card"
            data-teacher-id="${teacher.id}"
          >

            <a
              href="/teachers/${teacher.id}"
              class="teacher-card-link"
            >
              <div class="teacher-card-name">
                ${escapeHtml(teacher.name)}
              </div>
            </a>

            <div class="teacher-card-actions">

              <button
                type="button"
                class="teacher-action-button edit-teacher-button"
                onclick="editTeacher(${teacher.id})"
                title="Edit teacher"
              >
                ✎
              </button>

              <button
                type="button"
                class="teacher-action-button delete-teacher-button"
                onclick="deleteTeacher(
                  ${teacher.id},
                  '${escapeJsString(teacher.name)}'
                )"
                title="Delete teacher"
              >
                ×
              </button>

            </div>

          </div>

          <!-- Teacher edit / leave panel -->
          <div
            id="teacher-leave-panel-${teacher.id}"
            class="teacher-leave-panel"
            style="display: none;"
          >
            <div class="teacher-leave-box">

              <div class="panel-title">
                Edit ${escapeHtml(teacher.name)}
              </div>


              <!-- Working Days -->

              <div class="teacher-workdays-section">

                <div class="teacher-section-title">
                  Working Days
                </div>

                <div class="teacher-workdays">

                  ${[
                    [1, "Mon"],
                    [2, "Tue"],
                    [3, "Wed"],
                    [4, "Thu"],
                    [5, "Fri"],
                    [6, "Sat"]
                  ].map(([dayNum, dayName]) => `

                    <label class="workday-checkbox">

                      <input
                        type="checkbox"
                        class="teacher-workday"
                        value="${dayNum}"
                        ${
                          workDays.includes(String(dayNum))
                            ? "checked"
                            : ""
                        }
                      >

                      <span>${dayName}</span>

                    </label>

                  `).join("")}

                </div>

                <button
                  type="button"
                  class="add-course-save"
                  onclick="saveTeacherWorkDays(${teacher.id})"
                >
                  Save Working Days
                </button>

              </div>


              <!-- Existing Leave -->

              <div class="teacher-leave-section">

                <div class="teacher-leave-section-title">
                  Existing Teacher Leave
                </div>

                <div class="teacher-leave-existing">

                  ${
                    leaves.length
                      ? leaves.map(leave => `

                        <div class="teacher-leave-item">

                          <div class="teacher-leave-item-info">

                            <div class="teacher-leave-dates">
                              ${escapeHtml(leave.start_date)}
                              -
                              ${escapeHtml(leave.end_date)}
                            </div>

                            ${
                              leave.note
                                ? `
                                  <div class="teacher-leave-note">
                                    ${escapeHtml(leave.note)}
                                  </div>
                                `
                                : ""
                            }

                          </div>

                          <button
                            type="button"
                            class="teacher-leave-delete-button"
                            onclick="deleteTeacherLeave(${leave.id})"
                            title="Delete leave"
                          >
                            ×
                          </button>

                        </div>

                      `).join("")

                      : `
                        <div class="teacher-leave-empty">
                          No leave records.
                        </div>
                      `
                  }

                </div>


                <div class="teacher-leave-divider"></div>


                <!-- Add Leave -->

                <div class="teacher-leave-section-title">
                  Add Teacher Leave
                </div>

                <div class="teacher-leave-form">

                  <div class="form-row">

                    <div class="form-group">

                      <label>
                        Start Date
                      </label>

                      <input
                        type="date"
                        id="leave-start-${teacher.id}"
                      >

                    </div>


                    <div class="form-group">

                      <label>
                        End Date
                      </label>

                      <input
                        type="date"
                        id="leave-end-${teacher.id}"
                      >

                    </div>

                  </div>


                  <div class="form-group">

                    <label>
                      Note
                    </label>

                    <input
                      type="text"
                      id="leave-note-${teacher.id}"
                      placeholder="Note"
                    >

                  </div>


                  <div class="panel-actions">

                    <button
                      type="button"
                      class="add-course-save"
                      onclick="saveTeacherLeave(${teacher.id})"
                    >
                      Add Leave
                    </button>

                    <button
                      type="button"
                      class="add-course-cancel"
                      onclick="closeTeacherLeave(${teacher.id})"
                    >
                      Close
                    </button>

                  </div>

                </div>

              </div>

            </div>
          </div>
        `;
      }).join("")
    : `<div class="empty-cell">No teachers found.</div>`;


  return renderPage(`

    <div class="container">

      <div class="teacher-list-header">

        <div>
          <h1>Teacher Schedule</h1>

          <p>
            Select a teacher to view their weekly schedule.
          </p>
        </div>

        <div class="teacher-list-header-actions">

          <button
            type="button"
            class="add-course-button"
            onclick="openAddTeacher()"
          >
            + Add Teacher
          </button>

          <button
            type="button"
            class="add-course-button edit-teachers-button"
            onclick="toggleTeacherEditMode()"
          >
            Edit Teachers
          </button>

        </div>

      </div>


      <div class="teacher-list">

        ${teacherCards}

      </div>


      <!-- Add Teacher Panel -->

      <div
        id="add-teacher-panel"
        class="add-course-panel"
        style="display: none;"
      >
        <div class="add-teacher-box">

          <div class="panel-title">
            Add Teacher
          </div>

          <div class="form-group">

            <label for="new-teacher-name">
              Teacher Name
            </label>

            <input
              type="text"
              id="new-teacher-name"
              placeholder="Teacher name"
            >

          </div>


          <div class="form-group">

            <label>
              Working Days
            </label>

            <div class="teacher-workdays">

              ${[
                [1, "Mon"],
                [2, "Tue"],
                [3, "Wed"],
                [4, "Thu"],
                [5, "Fri"],
                [6, "Sat"]
              ].map(([dayNum, dayName]) => `

                <label class="workday-checkbox">

                  <input
                    type="checkbox"
                    class="new-teacher-workday"
                    value="${dayNum}"
                    ${Number(dayNum) <= 5 ? "checked" : ""}
                  >

                  <span>${dayName}</span>

                </label>

              `).join("")}

            </div>

          </div>


          <div class="panel-actions">

            <button
              type="button"
              class="add-course-save"
              onclick="saveNewTeacher()"
            >
              Save
            </button>

            <button
              type="button"
              class="add-course-cancel"
              onclick="closeAddTeacher()"
            >
              Cancel
            </button>

          </div>

        </div>
      </div>

    </div>


    <script>

      function openAddTeacher() {
        document.getElementById(
          "add-teacher-panel"
        ).style.display = "flex";
      }


      function closeAddTeacher() {
        document.getElementById(
          "add-teacher-panel"
        ).style.display = "none";
      }


      function toggleTeacherEditMode() {

        document
          .querySelectorAll(".teacher-card-actions")
          .forEach(function(element) {

            if (element.style.display === "none") {
              element.style.display = "flex";
            } else {
              element.style.display = "none";
            }

          });

      }


      function editTeacher(teacherId) {

        const panel =
          document.getElementById(
            "teacher-leave-panel-" + teacherId
          );

        if (panel) {
          panel.style.display = "flex";
        }

      }


      function closeTeacherLeave(teacherId) {

        const panel =
          document.getElementById(
            "teacher-leave-panel-" + teacherId
          );

        if (panel) {
          panel.style.display = "none";
        }

      }


      async function saveNewTeacher() 
      {
        const name =
          document
            .getElementById("new-teacher-name")
            .value
            .trim();

        if (!name) {
          alert("Please enter a teacher name.");
          return;
        }


        const checkboxes =
          document.querySelectorAll(
            ".new-teacher-workday:checked"
          );

        const workDays =
          Array.from(checkboxes)
            .map(cb => cb.value)
            .join(",");


        if (!workDays) {
          alert("Please select at least one working day.");
          return;
        }


        const formData = new FormData();

        formData.append(
          "teacher_name",
          name
        );

        formData.append(
          "work_days",
          workDays
        );


        const response =
          await fetch(
            "/create-teacher",
            {
              method: "POST",
              body: formData
            }
          );


        if (!response.ok) {
          alert("Failed to create teacher.");
          return;
        }


        window.location.href = "/teachers";
      }


      async function deleteTeacher(
        teacherId,
        teacherName
      ) {

        if (
          !confirm(
            "Remove teacher " +
            teacherName +
            " from the active teacher list?"
          )
        ) {
          return;
        }

        const formData = new FormData();

        formData.append(
          "teacher_id",
          teacherId
        );

        const response =
          await fetch("/delete-teacher", {
            method: "POST",
            body: formData
          });

        if (!response.ok) {
          alert("Failed to delete teacher.");
          return;
        }

        window.location.reload();

      }


      async function saveTeacherWorkDays(
        teacherId
      ) {

        const panel =
          document.getElementById(
            "teacher-leave-panel-" + teacherId
          );

        const checkboxes =
          panel.querySelectorAll(
            ".teacher-workday:checked"
          );

        const workDays =
          Array.from(checkboxes)
            .map(
              function(cb) {
                return cb.value;
              }
            )
            .join(",");

        const formData = new FormData();

        formData.append(
          "teacher_id",
          teacherId
        );

        formData.append(
          "work_days",
          workDays
        );

        const response =
          await fetch(
            "/update-teacher-workdays",
            {
              method: "POST",
              body: formData
            }
          );

        if (!response.ok) {
          alert(
            "Failed to update working days."
          );
          return;
        }

        window.location.reload();

      }


      async function saveTeacherLeave(
        teacherId
      ) {

        const startDate =
          document.getElementById(
            "leave-start-" + teacherId
          ).value;

        const endDate =
          document.getElementById(
            "leave-end-" + teacherId
          ).value;

        const note =
          document.getElementById(
            "leave-note-" + teacherId
          ).value.trim();

        if (!startDate || !endDate) {
          alert(
            "Please select start and end dates."
          );
          return;
        }

        const formData = new FormData();

        formData.append(
          "teacher_id",
          teacherId
        );

        formData.append(
          "start_date",
          startDate
        );

        formData.append(
          "end_date",
          endDate
        );

        formData.append(
          "note",
          note
        );

        const response =
          await fetch(
            "/create-teacher-leave",
            {
              method: "POST",
              body: formData
            }
          );

        if (!response.ok) {
          alert("Failed to add teacher leave.");
          return;
        }

        window.location.reload();

      }


      async function deleteTeacherLeave(
        leaveId
      ) {

        if (!confirm("Delete this leave record?")) {
          return;
        }

        const formData = new FormData();

        formData.append(
          "leave_id",
          leaveId
        );

        const response =
          await fetch(
            "/delete-teacher-leave",
            {
              method: "POST",
              body: formData
            }
          );

        if (!response.ok) {
          alert("Failed to delete leave.");
          return;
        }

        window.location.reload();

      }

    </script>

  `);
}

// ========== 查看教师课表 （teacher/id.html）
function renderTeacherSchedulePage({
  teacher,
  teachers,
  teacher_id,
  days,
  week_dates,
  week_start,
  week_end,
  selected_date
}: {
  teacher: any;
  teachers: any[];
  teacher_id: number;
  days: any[];
  week_dates: Date[];
  week_start: Date;
  week_end: Date;
  selected_date: Date;
}): string {

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];

  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ];


  function formatLongDate(date: Date): string {
    return (
      monthNames[date.getMonth()] +
      " " +
      String(date.getDate()).padStart(2, "0") +
      ", " +
      date.getFullYear()
    );
  }


  function formatDayName(date: Date): string {
    return dayNames[date.getDay()];
  }


  function formatMonthDay(date: Date): string {
    return (
      String(date.getMonth() + 1).padStart(2, "0") +
      "/" +
      String(date.getDate()).padStart(2, "0")
    );
  }


  const teacherOptions = teachers
    .map(item => `
      <option
        value="${item.id}"
        ${
          Number(item.id) === Number(teacher_id)
            ? "selected"
            : ""
        }
      >
        ${escapeHtml(item.name)}
      </option>
    `)
    .join("");


  const dayColumns = days
    .map(day => {

      const courses = day.courses || [];


      const courseHtml = courses.length
        ? courses.map((course: any) => `

            <div
              class="course-block"
              style="
                --school-background: ${escapeHtml(
                  course.school_background
                )};
                --school-border: ${escapeHtml(
                  course.school_border
                )};
              "
            >

              <div class="course-school">
                ${escapeHtml(course.school_name)}
              </div>


              <div class="course-name">
                ${escapeHtml(course.course_name)}
              </div>


              <div class="course-time">
                ${escapeHtml(
                  course.start_time_display
                )}
                -
                ${escapeHtml(
                  course.end_time_display
                )}
              </div>


              <div class="course-details">

                ${
                  course.classroom
                    ? `
                      <span>
                        📍 ${escapeHtml(
                          course.classroom
                        )}
                      </span>
                    `
                    : ""
                }


                ${
                  course.group_name
                    ? `
                      <span>
                        👥 ${escapeHtml(
                          course.group_name
                        )}
                      </span>
                    `
                    : ""
                }


                ${
                  course.student_number
                    ? `
                      <span>
                        👦
                        ${escapeHtml(
                          course.student_number
                        )}
                        kids
                      </span>
                    `
                    : ""
                }

              </div>


              ${
                course.assignment_source ===
                "inherited"
                  ? `
                    <div
                      class="teacher-schedule-inherited"
                    >
                      Inherited from previous schedule
                    </div>
                  `
                  : ""
              }

            </div>

          `).join("")
        : `
            <div class="teacher-empty-day">
              No classes
            </div>
          `;


      return `
        <div class="day-column">

          <div class="day-header">

            <div class="day-name">
              ${formatDayName(day.date)}
            </div>

            <div class="day-date">
              ${formatMonthDay(day.date)}
            </div>

          </div>


          <div class="day-courses">

            ${courseHtml}

          </div>

        </div>
      `;
    })
    .join("");


  const selectedDateString =
    formatDate(selected_date);


  return renderPage(`

    <div class="container">

      <div class="teacher-schedule-header">


        <!-- =========================================
             Header
             ========================================= -->

        <div>

          <a
            href="/"
            class="back-to-schedule"
          >
            ← Back to Schedule
          </a>


          <h1>
            ${escapeHtml(teacher.name)}'s Schedule
          </h1>


          <div class="week-range">

            ${formatLongDate(week_start)}

            -

            ${formatLongDate(week_end)}

          </div>

        </div>


        <!-- =========================================
             Controls
             ========================================= -->

        <div class="teacher-controls">

          <select
            id="teacher-selector"
            onchange="changeTeacher()"
          >

            ${teacherOptions}

          </select>


          <div class="week-navigation">

            <button
              type="button"
              onclick="changeWeek(-7)"
            >
              ← Previous
            </button>


            <button
              type="button"
              onclick="goToToday()"
            >
              Today
            </button>


            <button
              type="button"
              onclick="changeWeek(7)"
            >
              Next →
            </button>

          </div>

        </div>

      </div>


      <!-- =========================================
           Weekly Columns
           ========================================= -->

      <div class="weekly-columns">

        ${dayColumns}

      </div>

    </div>


    <script>

      function changeTeacher() {

        const selector =
          document.getElementById(
            "teacher-selector"
          );

        const teacherId =
          selector.value;

        const date =
          "${selectedDateString}";

        window.location.href =
          "/teachers/"
          + teacherId
          + "?date_str="
          + date;
      }


      function changeWeek(days) {

        const currentDate =
          new Date(
            "${selectedDateString}T12:00:00"
          );

        currentDate.setDate(
          currentDate.getDate() + days
        );


        const year =
          currentDate.getFullYear();

        const month =
          String(
            currentDate.getMonth() + 1
          ).padStart(2, "0");

        const day =
          String(
            currentDate.getDate()
          ).padStart(2, "0");


        const newDate =
          year +
          "-" +
          month +
          "-" +
          day;


        window.location.href =
          "/teachers/${teacher_id}"
          + "?date_str="
          + newDate;
      }


      function goToToday() {

        const today =
          new Date();


        const year =
          today.getFullYear();

        const month =
          String(
            today.getMonth() + 1
          ).padStart(2, "0");

        const day =
          String(
            today.getDate()
          ).padStart(2, "0");


        const todayString =
          year +
          "-" +
          month +
          "-" +
          day;


        window.location.href =
          "/teachers/${teacher_id}"
          + "?date_str="
          + todayString;
      }

    </script>

  `);
}

// ========== 编辑页面 （edit） =============
function renderEditPage({
  schools,
  teachers,
  days,
  calendarEvents,
  weekStart,
  weekEnd,
  selectedDate
}: {
  schools: any[];
  teachers: any[];
  days: any[];
  weekStart: string;
  weekEnd: string;
  selectedDate: string;
}): string {

  /*
   * Teacher data for dynamically added teacher rows.
   *
   * Escape < characters so a teacher name cannot accidentally
   * close the <script> tag.
   */
  const teacherJson = JSON.stringify(
    teachers.map(teacher => ({
      id: Number(teacher.id),
      name: String(teacher.name || "")
    }))
  )
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  /*
   * ---------------------------------------------------------
   * Add Course - school options
   * ---------------------------------------------------------
   */

  const schoolOptions = schools
    .filter(
      school =>
        school.status !== "hidden"
    )
    .map(
      school => `
        <option value="${school.id}">
          ${escapeHtml(school.name)}
        </option>
      `
    )
    .join("");

  /*
  * ---------------------------------------------------------
  * Manage Schools
  * ---------------------------------------------------------
  */

  const manageSchoolsPanel = `
    <div
      id="manage-schools-panel"
      class="add-course-panel"
      style="display: none;"
    >

      <div class="add-course-box">

        <div class="add-course-header">

          <div>
            <h2>Manage Schools</h2>

            <p>
              Manage school status and colors.
            </p>
          </div>

          <button
            type="button"
            class="close-course-button"
            onclick="closeManageSchools()"
          >
            ×
          </button>

        </div>

        <div
          id="manage-schools-list"
          class="manage-schools-list"
        >
        </div>

        <div class="add-course-actions">

          <button
            type="button"
            class="add-course-save-button"
            onclick="saveSchools()"
          >
            Save Changes
          </button>

          <button
            type="button"
            class="add-school-button"
            onclick="openAddSchool()"
          >
            + School
          </button>

          <button
            type="button"
            class="add-course-cancel-button"
            onclick="closeManageSchools()"
          >
            Cancel
          </button>

        </div>

        <div
          id="manage-schools-message"
          class="add-course-message"
        ></div>

      </div>

    </div>
  `;
  /*
   * ---------------------------------------------------------
   * Add School
   * ---------------------------------------------------------
   */

  const addSchoolPanel = `
    <div
      id="add-school-panel"
      class="add-course-panel"
      style="display: none;"
    >

      <div class="add-school-box">

        <div class="add-course-header">

          <div>
            <h2>Add School</h2>

            <p>
              Add a new school to EduScheduler.
            </p>
          </div>

          <button
            type="button"
            class="course-action-button delete-course-button"
            onclick="closeAddSchool()"
          >
            ×
          </button>

        </div>

        <div class="add-course-field">

          <label>School Name</label>

          <input
            type="text"
            id="add-school-name"
            placeholder="School name"
          >

        </div>

        <div class="add-course-actions">

          <button
            type="button"
            class="add-course-save-button"
            onclick="saveNewSchool()"
          >
            Add School
          </button>

          <button
            type="button"
            class="add-course-cancel-button"
            onclick="closeAddSchool()"
          >
            Cancel
          </button>

        </div>

        <div
          id="add-school-message"
          class="add-course-message"
        ></div>

      </div>

    </div>
  `;

  /*
   * ---------------------------------------------------------
   * Add Course
   * ---------------------------------------------------------
   */

  const addCoursePanel = `
    <div
      id="add-course-panel"
      class="add-course-panel"
      style="display: none;"
    >

      <div class="add-course-box">

        <div class="add-course-header">

          <div>
            <h2>Add Course</h2>

            <p>
              Add a new recurring course to the schedule.
            </p>
          </div>

          <button
            type="button"
            class="close-course-button"
            onclick="closeAddCourse()"
          >
            ×
          </button>

        </div>

        <div class="add-course-field">

          <label>School</label>

          <div class="school-select-row">

            <select id="add-school">

              <option value="">
                -- Select School --
              </option>

              ${schoolOptions}

            </select>

            <button
              type="button"
              class="add-school-button"
              onclick="openAddSchool()"
            >
              + School
            </button>

          </div>

        </div>

        <div class="add-course-field">

          <label>Course</label>

          <input
            type="text"
            id="add-course-name"
            placeholder="Course name"
          >

        </div>

        <div class="add-course-field">

          <label>Day</label>

          <select id="add-day">

            <option value="1">Monday</option>
            <option value="2">Tuesday</option>
            <option value="3">Wednesday</option>
            <option value="4">Thursday</option>
            <option value="5">Friday</option>
            <option value="6">Saturday</option>
            <option value="7">Sunday</option>

          </select>

        </div>

        <div class="add-course-time-row">

          <div class="add-course-field">

            <label>Start Time</label>

            <input
              type="time"
              id="add-start-time"
            >

          </div>

          <div class="add-course-field">

            <label>End Time</label>

            <input
              type="time"
              id="add-end-time"
            >

          </div>

        </div>

        <div class="add-course-date-row">

          <div class="add-course-field">

            <label>Start Date</label>

            <input
              type="date"
              id="add-start-date"
              value="${escapeHtml(weekStart)}"
            >

          </div>

          <div class="add-course-field">

            <label>End Date</label>

            <input
              type="date"
              id="add-end-date"
              value="${escapeHtml(weekEnd)}"
            >

          </div>

        </div>

        <div class="add-course-field">

          <label>Room</label>

          <input
            type="text"
            id="add-classroom"
            placeholder="Optional"
          >

        </div>

        <div class="add-course-field">

          <label>Group</label>

          <input
            type="text"
            id="add-group"
            placeholder="Optional"
          >

        </div>

        <div class="add-course-field">

          <label>Students</label>

          <input
            type="number"
            min="0"
            id="add-student-number"
            placeholder="Optional"
          >

        </div>

        <div class="add-course-actions">

          <button
            type="button"
            class="add-course-save-button"
            onclick="saveNewCourse()"
          >
            Add Course
          </button>

          <button
            type="button"
            class="add-course-cancel-button"
            onclick="closeAddCourse()"
          >
            Cancel
          </button>

        </div>

        <div
          id="add-course-message"
          class="add-course-message"
        ></div>

      </div>

    </div>
  `;

  /*
   * ---------------------------------------------------------
   * Course data for Schedule Exceptions
   * ---------------------------------------------------------
   *
   * We use the courses currently rendered in this week.
   * Later, if necessary, this can become a separate API.
   */

  const allCoursesForJs: any[] = [];

  for (const day of days) {
    for (const course of (day.courses || [])) {
      allCoursesForJs.push({
        id: Number(course.id),
        schoolId: Number(course.school_id),
        courseName: String(course.course_name || ""),
        groupName: String(course.group_name || ""),
        dayOfWeek: Number(course.day_of_week),
        startTime: String(course.start_time_display || ""),
        endTime: String(course.end_time_display || ""),
        startDate: course.start_date
          ? String(course.start_date)
          : "",
        endDate: course.end_date
          ? String(course.end_date)
          : ""
      });
    }
  }

  const coursesJson = JSON.stringify(allCoursesForJs)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  /*
   * ---------------------------------------------------------
   * Schedule Exceptions
   * ---------------------------------------------------------
   *
   * At this stage the panel is rendered with data already
   * available to the Worker.
   */

  const exceptionEvents =
    calendarEvents as any[];

  /*
   * Avoid duplicate events if calendar_events were attached
   * to each day.
   */
  const uniqueEvents = new Map<number, any>();

  for (const event of exceptionEvents) {
    uniqueEvents.set(Number(event.id), event);
  }

  const uniqueCalendarEvents = Array.from(
    uniqueEvents.values()
  );

  const exceptionPanel = `
    <div
      id="school-holiday-panel"
      class="add-course-panel"
      style="display: none;"
    >

      <div class="add-course-box">

        <div class="add-course-header">

          <h2>Schedule Exceptions</h2>

          <button
            type="button"
            class="close-course-button"
            onclick="closeSchoolHoliday()"
          >
            ×
          </button>

        </div>

        <form
          method="post"
          action="/create-schedule-exception"
        >

          <div class="add-course-field">

            <label for="exception-school">
              School
            </label>

            <select
              id="exception-school"
              name="school_id"
              required
            >

              ${schools
                .filter(
                  school =>
                    school.status !== "hidden"
                )
                .map(
                  school => `
                    <option value="${school.id}">
                      ${escapeHtml(school.name)}
                    </option>
                  `
                )
                .join("")}

            </select>

          </div>

          <div class="add-course-field">

            <label>
              Applies To
            </label>

            <div class="exception-scope-options">

              <label>
                <input
                  type="radio"
                  name="scope"
                  value="school"
                  checked
                  onchange="toggleExceptionCourse()"
                >
                Entire School
              </label>

              <label>
                <input
                  type="radio"
                  name="scope"
                  value="course"
                  onchange="toggleExceptionCourse()"
                >
                Specific Course
              </label>

            </div>

          </div>

          <div
            class="add-course-field"
            id="exception-course-field"
            style="display: none;"
          >

            <label for="exception-course">
              Course
            </label>

            <select
              id="exception-course"
              name="course_id"
            >

              <option value="">
                Select a course
              </option>

            </select>

          </div>

          <div class="add-course-field">

            <label for="exception-type">
              Type
            </label>

            <select
              id="exception-type"
              name="type"
              required
            >

              <option value="holiday">
                Holiday
              </option>

              <option value="cancellation">
                Cancellation
              </option>

              <option value="other">
                Other
              </option>

            </select>

          </div>

          <div class="holiday-date-row">

            <div class="add-course-field">

              <label for="exception-start-date">
                Start Date
              </label>

              <input
                type="date"
                id="exception-start-date"
                name="start_date"
                value="${escapeHtml(weekStart)}"
                required
              >

            </div>

            <div class="add-course-field">

              <label for="exception-end-date">
                End Date
              </label>

              <input
                type="date"
                id="exception-end-date"
                name="end_date"
                value="${escapeHtml(weekEnd)}"
                required
              >

            </div>

          </div>

          <div class="add-course-field">

            <label for="exception-reason">
              Reason
            </label>

            <input
              type="text"
              id="exception-reason"
              name="reason"
              placeholder="e.g. Winter Holiday, Field Trip"
            >

          </div>

          <div class="add-course-actions">

            <button
              type="submit"
              class="add-course-save-button"
            >
              Add Exception
            </button>

            <button
              type="button"
              class="add-course-cancel-button"
              onclick="closeSchoolHoliday()"
            >
              Cancel
            </button>

          </div>

        </form>

        <div class="school-holiday-existing">

          <h3>
            Existing Schedule Exceptions of Current Week
          </h3>

          ${
            uniqueCalendarEvents.length
              ? uniqueCalendarEvents.map(event => {

                  const school =
                    schools.find(
                      s =>
                        Number(s.id) ===
                        Number(event.school_id)
                    );

                  const course =
                    event.course_id
                      ? allCoursesForJs.find(
                          c =>
                            Number(c.id) ===
                            Number(event.course_id)
                        )
                      : null;

                  let title =
                    event.reason;

                  if (!title) {
                    if (event.type === "holiday") {
                      title = "Holiday";
                    } else if (
                      event.type === "cancellation"
                    ) {
                      title = "Cancellation";
                    } else {
                      title =
                        "Schedule Exception";
                    }
                  }

                  return `
                    <div class="school-holiday-item">

                      <div class="school-holiday-info">

                        <div class="school-holiday-name">
                          ${escapeHtml(title)}
                        </div>

                        <div class="school-holiday-details">

                          <span>
                            ${escapeHtml(event.start_date)}
                            –
                            ${escapeHtml(event.end_date)}
                          </span>

                          ${
                            school
                              ? `
                                <span>
                                  ${escapeHtml(school.name)}
                                </span>
                              `
                              : ""
                          }

                          ${
                            course
                              ? `
                                <span>
                                  ${escapeHtml(
                                    course.courseName
                                  )}
                                  ${
                                    course.groupName
                                      ? `
                                        -
                                        ${escapeHtml(
                                          course.groupName
                                        )}
                                      `
                                      : ""
                                  }
                                </span>
                              `
                              : `
                                <span>
                                  Entire School
                                </span>
                              `
                          }

                          <span>
                            ${escapeHtml(
                              String(
                                event.type || ""
                              ).charAt(0).toUpperCase() +
                              String(
                                event.type || ""
                              ).slice(1)
                            )}
                          </span>

                        </div>

                      </div>

                      <form
                        method="post"
                        action="/delete-schedule-exception"
                        onsubmit="
                          return confirm(
                            'Delete this schedule exception?'
                          );
                        "
                      >

                        <input
                          type="hidden"
                          name="event_id"
                          value="${escapeHtml(event.id)}"
                        >

                        <input
                          type="hidden"
                          name="week_start"
                          value="${escapeHtml(weekStart)}"
                        >

                        <button
                          type="submit"
                          class="school-holiday-delete-button"
                        >
                          Delete
                        </button>

                      </form>

                    </div>
                  `;
                }).join("")
              : `
                <div class="school-holiday-empty">
                  No schedule exceptions in this week.
                </div>
              `
          }

        </div>

      </div>

    </div>
  `;

  /*
   * ---------------------------------------------------------
   * Weekly course columns
   * ---------------------------------------------------------
   */

  const weeklyColumns = days
    .map(day => {

      const courses =
        (day.courses || []) as any[];

      const courseHtml = courses.length
        ? courses
            .filter(
              course =>
                !course.is_holiday
            )
            .map(course => {

              const teacherIds =
                Array.isArray(course.teacher_ids)
                  ? course.teacher_ids
                  : [];

              /*
               * Make sure at least T1 and T2 exist.
               * Keep up to 4 teacher slots.
               */
              const normalizedTeacherIds =
                [
                  teacherIds[0] ?? null,
                  teacherIds[1] ?? null,
                  teacherIds[2] ?? null,
                  teacherIds[3] ?? null
                ];

              let teacherRows = "";

              for (
                let i = 0;
                i < 4;
                i++
              ) {

                const teacherId =
                  normalizedTeacherIds[i];

                /*
                 * Original behavior:
                 * T1 and T2 are always shown.
                 * T3/T4 only appear when they have a teacher.
                 */
                if (
                  i >= 2 &&
                  teacherId === null
                ) {
                  continue;
                }

                const options =
                  teachers
                    .map(teacher => `
                      <option
                        value="${escapeHtml(
                          teacher.id
                        )}"
                        ${
                          Number(
                            teacher.id
                          ) ===
                          Number(
                            teacherId
                          )
                            ? "selected"
                            : ""
                        }
                      >
                        ${escapeHtml(
                          teacher.name
                        )}
                      </option>
                    `)
                    .join("");

                teacherRows += `
                  <div class="teacher-row">

                    <label>
                      T${i + 1}
                    </label>

                    <select
                      name="teacher_${escapeHtml(
                        course.id
                      )}_${escapeHtml(
                        formatDate(day.date)
                      )}_${i + 1}"
                    >

                      <option value="">
                        -- Unassigned --
                      </option>

                      ${options}

                    </select>

                  </div>
                `;
              }

              /*
               * Show Add Teacher if T3 is empty.
               */
              const showAddTeacher =
                normalizedTeacherIds[2] === null;

              /*
               * Leave warnings
               */
              const leaveWarnings =
                Array.isArray(
                  course.teacher_leave_warnings
                )
                  ? course.teacher_leave_warnings
                  : [];

              const leaveWarningHtml =
                leaveWarnings.length
                  ? `
                    <div class="teacher-leave-warnings">

                      ${leaveWarnings
                        .map(warning => `
                          <div class="leave-warning">

                            ⚠ Teacher on leave

                            <div class="leave-details">

                              ${escapeHtml(
                                warning.teacher_name
                              )}

                              ${
                                warning.note
                                  ? `
                                    —
                                    ${escapeHtml(
                                      warning.note
                                    )}
                                  `
                                  : ""
                              }

                            </div>

                          </div>
                        `)
                        .join("")}

                    </div>
                  `
                  : "";

              /*
               * Working day warnings
               */
              const workingDayWarnings: any[] = [];

              for (
                const teacherId of normalizedTeacherIds
              ) {

                if (
                  teacherId === null ||
                  teacherId === undefined
                ) {
                  continue;
                }

                const teacher =
                  teachers.find(
                    t =>
                      Number(t.id) ===
                      Number(teacherId)
                  );

                if (!teacher) {
                  continue;
                }

                const workDays =
                  String(
                    teacher.work_days || ""
                  )
                    .split(",")
                    .map(
                      value =>
                        value.trim()
                    )
                    .filter(
                      value =>
                        value !== ""
                    );

                const jsDay =
                  day.date.getDay();

                const dayNumber =
                  jsDay === 0
                    ? 7
                    : jsDay;

                if (
                  !workDays.includes(
                    String(dayNumber)
                  )
                ) {
                  workingDayWarnings.push(
                    teacher
                  );
                }
              }

              const workingDayWarningHtml =
                workingDayWarnings.length
                  ? `
                    <div class="teacher-leave-warnings">

                      ${workingDayWarnings
                        .map(teacher => `
                          <div class="leave-warning">

                            ⚠ Teacher not working on this day

                            <div class="leave-details">

                              ${escapeHtml(
                                teacher.name
                              )}

                            </div>

                          </div>
                        `)
                        .join("")}

                    </div>
                  `
                  : "";

              /*
               * Teacher conflicts
               */
              const conflicts =
                Array.isArray(
                  course.teacher_conflicts
                )
                  ? course.teacher_conflicts
                  : [];

              const conflictHtml =
                conflicts.length
                  ? `
                    <div class="teacher-conflicts">

                      ${conflicts
                        .map(conflict => `
                          <div class="conflict-warning">

                            ⚠ Teacher conflict

                            <div class="conflict-details">

                              ${escapeHtml(
                                conflict.teacher_name
                              )}

                              is also assigned to

                              <strong>
                                ${escapeHtml(
                                  conflict.course_name
                                )}
                              </strong>

                              (
                              ${escapeHtml(
                                conflict.start_time
                              )}
                              -
                              ${escapeHtml(
                                conflict.end_time
                              )}
                              )

                            </div>

                          </div>
                        `)
                        .join("")}

                    </div>
                  `
                  : "";

              return `
                <div
                  class="course-block"
                  data-course-id="${escapeHtml(
                    course.id
                  )}"
                  style="
                    --school-background:
                      ${escapeHtml(
                        course.school_background
                      )};
                    --school-border:
                      ${escapeHtml(
                        course.school_border
                      )};
                  "
                >

                  <div class="course-card-actions">

                    <button
                      type="button"
                      class="course-action-button edit-course-button"
                      onclick="editCourse(this)"
                      title="Edit course"
                    >
                      ✎
                    </button>

                    <button
                      type="button"
                      class="course-action-button delete-course-button"
                      onclick='
                        deleteCourse(
                          ${Number(course.id)},
                          ${JSON.stringify(
                            String(
                              course.course_name ||
                              ""
                            )
                          )}
                        )
                      '
                      title="Delete course"
                    >
                      ×
                    </button>

                  </div>

                  <!-- Course display -->

                  <div class="course-display">

                    <div class="course-school">
                      ${escapeHtml(
                        course.school_name
                      )}
                    </div>

                    <div class="course-name">
                      ${escapeHtml(
                        course.course_name
                      )}
                    </div>

                    <div class="course-time">
                      ${escapeHtml(
                        course.start_time_display
                      )}
                      -
                      ${escapeHtml(
                        course.end_time_display
                      )}
                    </div>

                    <div class="course-details">

                      ${
                        course.classroom
                          ? `
                            <span>
                              📍
                              ${escapeHtml(
                                course.classroom
                              )}
                            </span>
                          `
                          : ""
                      }

                      ${
                        course.group_name
                          ? `
                            <span>
                              👥
                              ${escapeHtml(
                                course.group_name
                              )}
                            </span>
                          `
                          : ""
                      }

                      ${
                        course.student_number !==
                        null &&
                        course.student_number !==
                        undefined &&
                        course.student_number !== ""
                          ? `
                            <span>
                              👦
                              ${escapeHtml(
                                course.student_number
                              )}
                              kids
                            </span>
                          `
                          : ""
                      }

                    </div>

                  </div>

                  <!-- Course edit -->

                  <div
                    class="course-edit"
                    style="display: none;"
                  >

                    <div class="course-edit-field">

                      <label>
                        Course
                      </label>

                      <input
                        type="text"
                        class="edit-course-name"
                        value="${escapeHtml(
                          course.course_name
                        )}"
                      >

                    </div>

                    <div class="course-edit-time-row">

                      <div class="course-edit-field">

                        <label>
                          Start Time
                        </label>

                        <input
                          type="time"
                          class="edit-start-time"
                          value="${escapeHtml(
                            course.start_time_display
                          )}"
                        >

                      </div>

                      <div class="course-edit-field">

                        <label>
                          End Time
                        </label>

                        <input
                          type="time"
                          class="edit-end-time"
                          value="${escapeHtml(
                            course.end_time_display
                          )}"
                        >

                      </div>

                    </div>

                    <div class="course-edit-date-row">

                      <div class="course-edit-field">

                        <label>
                          Start Date
                        </label>

                        <input
                          type="date"
                          class="edit-start-date"
                          value="${escapeHtml(
                            course.start_date || ""
                          )}"
                        >

                      </div>

                      <div class="course-edit-field">

                        <label>
                          End Date
                        </label>

                        <input
                          type="date"
                          class="edit-end-date"
                          value="${escapeHtml(
                            course.end_date || ""
                          )}"
                        >

                      </div>

                    </div>

                    <div class="course-edit-field">

                      <label>
                        Room
                      </label>

                      <input
                        type="text"
                        class="edit-classroom"
                        value="${escapeHtml(
                          course.classroom || ""
                        )}"
                      >

                    </div>

                    <div class="course-edit-field">

                      <label>
                        Group
                      </label>

                      <input
                        type="text"
                        class="edit-group"
                        value="${escapeHtml(
                          course.group_name || ""
                        )}"
                      >

                    </div>

                    <div class="course-edit-field">

                      <label>
                        Students
                      </label>

                      <input
                        type="number"
                        min="0"
                        class="edit-student-number"
                        value="${
                          course.student_number !==
                            null &&
                          course.student_number !==
                            undefined
                            ? escapeHtml(
                                course.student_number
                              )
                            : ""
                        }"
                      >

                    </div>

                    <div class="course-edit-actions">

                      <button
                        type="button"
                        class="course-save-button"
                        onclick="saveCourse(this)"
                      >
                        Save
                      </button>

                      <button
                        type="button"
                        class="course-cancel-button"
                        onclick="
                          cancelCourseEdit(this)
                        "
                      >
                        Cancel
                      </button>

                    </div>

                    <div
                      class="course-edit-message"
                    ></div>

                  </div>

                  ${
                    course.assignment_inherited
                      ? `
                        <div class="inherited-label">
                          ↳ Inherited
                        </div>
                      `
                      : ""
                  }

                  <!-- Teachers -->

                  <div
                    class="teacher-section"
                    data-course-id="${escapeHtml(
                      course.id
                    )}"
                    data-date="${escapeHtml(
                      formatDate(day.date)
                    )}"
                  >

                    ${teacherRows}

                    ${
                      showAddTeacher
                        ? `
                          <button
                            type="button"
                            class="add-teacher-button"
                            onclick="addTeacher(this)"
                          >
                            + Add Teacher
                          </button>
                        `
                        : ""
                    }

                  </div>

                  ${leaveWarningHtml}

                  ${workingDayWarningHtml}

                  ${conflictHtml}

                </div>
              `;
            })
            .join("")
        : `
          <div class="empty-cell">
            —
          </div>
        `;

      /*
       * Free teachers
       */
      const freeTeachers =
        Array.isArray(day.free_teachers)
          ? day.free_teachers
          : [];

      const freeTeacherHtml =
        freeTeachers.length
          ? `
            <div class="free-teachers-list">

              ${freeTeachers
                .map(teacher => `
                  <span
                    class="free-teacher-chip"
                    title="${escapeHtml(
                      teacher.status || ""
                    )}"
                  >
                    ${escapeHtml(
                      teacher.name
                    )}
                  </span>
                `)
                .join("")}

            </div>
          `
          : `
            <div class="free-teachers-empty">
              Everyone is busy.
            </div>
          `;

      const dayName =
        day.date.toLocaleDateString(
          "en-US",
          { weekday: "long" }
        );

      const dayDate =
        `${String(
          day.date.getMonth() + 1
        ).padStart(2, "0")}/${String(
          day.date.getDate()
        ).padStart(2, "0")}`;

      return `
        <div class="day-column">

          <div class="day-header">

            <div class="day-name">
              ${escapeHtml(dayName)}
            </div>

            <div class="day-date">
              ${escapeHtml(dayDate)}
            </div>

          </div>

          <div class="day-courses">

            ${courseHtml}

          </div>

          <div class="free-teachers">

            <div class="free-teachers-title">

              Free today
              (${freeTeachers.length})

            </div>

            ${freeTeacherHtml}

          </div>

        </div>
      `;
    })
    .join("");

  /*
   * ---------------------------------------------------------
   * Final page
   * ---------------------------------------------------------
   */

  return renderPage(`
    <div class="container">

      <div class="schedule-header">

        <div>

          <h1>
            Weekly Schedule
          </h1>

          <div class="week-range">

            ${escapeHtml(weekStart)}

            –

            ${escapeHtml(weekEnd)}

          </div>

        </div>

        <div class="schedule-controls">

          <div class="schedule-action-row">

            <button
              type="button"
              class="add-course-button"
              onclick="openManageSchools()"
            >
              Manage Schools
            </button>

            <button
              type="button"
              class="add-course-button"
              onclick="openSchoolHoliday()"
            >
              Edit School Holidays
            </button>

            <button
              type="button"
              class="add-course-button"
              onclick="openAddCourse()"
            >
              + Add Course
            </button>

          </div>

          <div class="date-selector">

            <input
              type="date"
              id="date-picker"
              value="${escapeHtml(
                selectedDate
              )}"
            >

            <button
              type="button"
              onclick="goToDate()"
            >
              Go
            </button>

          </div>

          <div class="week-navigation">

            <button
              type="button"
              onclick="changeWeek(-7)"
            >
              ← Previous
            </button>

            <button
              type="button"
              onclick="goToday()"
            >
              Today
            </button>

            <button
              type="button"
              onclick="changeWeek(7)"
            >
              Next →
            </button>

          </div>

        </div>

      </div>
      ${manageSchoolsPanel}

      ${addCoursePanel}

      ${exceptionPanel}

      ${addSchoolPanel}

      <form
        method="post"
        action="/save-assignments"
      >

        <input
          type="hidden"
          name="week_start"
          value="${escapeHtml(
            weekStart
          )}"
        >

        <div class="weekly-columns">

          ${weeklyColumns}

        </div>

        <div class="save-area">

          <button
            type="submit"
            class="save-button"
          >
            Save Week
          </button>

        </div>

      </form>

    </div>

    <script>

      const teacherData =
        ${teacherJson};

      const exceptionCourseData =
        ${coursesJson};

      function goToDate() {

        const datePicker =
          document.getElementById(
            "date-picker"
          );

        const selectedDate =
          datePicker.value;

        if (!selectedDate) {
          return;
        }

        window.location.href =
          "/edit?date_str=" +
          selectedDate;
      }


      function changeWeek(days) {

        const current =
          new Date(
            "${escapeJsString(
              selectedDate
            )}T12:00:00"
          );

        current.setDate(
          current.getDate() + days
        );

        const year =
          current.getFullYear();

        const month =
          String(
            current.getMonth() + 1
          ).padStart(2, "0");

        const day =
          String(
            current.getDate()
          ).padStart(2, "0");

        const dateString =
          year + "-" +
          month + "-" +
          day;

        window.location.href =
          "/edit?date_str=" +
          dateString;
      }


      function goToday() {

        const today =
          new Date();

        const year =
          today.getFullYear();

        const month =
          String(
            today.getMonth() + 1
          ).padStart(2, "0");

        const day =
          String(
            today.getDate()
          ).padStart(2, "0");

        const dateString =
          year + "-" +
          month + "-" +
          day;

        window.location.href =
          "/edit?date_str=" +
          dateString;
      }


      function addTeacher(button) {

        const section =
          button.closest(
            ".teacher-section"
          );

        const rows =
          section.querySelectorAll(
            ".teacher-row"
          );

        const nextSlot =
          rows.length + 1;

        if (nextSlot > 4) {
          return;
        }

        const courseId =
          section.dataset.courseId;

        const date =
          section.dataset.date;

        const row =
          document.createElement(
            "div"
          );

        row.className =
          "teacher-row";

        const label =
          document.createElement(
            "label"
          );

        label.textContent =
          "T" + nextSlot;

        const select =
          document.createElement(
            "select"
          );

        select.name =
          "teacher_" +
          courseId +
          "_" +
          date +
          "_" +
          nextSlot;

        const emptyOption =
          document.createElement(
            "option"
          );

        emptyOption.value = "";

        emptyOption.textContent =
          "-- Unassigned --";

        select.appendChild(
          emptyOption
        );

        teacherData.forEach(
          function (teacher) {

            const option =
              document.createElement(
                "option"
              );

            option.value =
              teacher.id;

            option.textContent =
              teacher.name;

            select.appendChild(
              option
            );
          }
        );

        row.appendChild(label);
        row.appendChild(select);

        section.insertBefore(
          row,
          button
        );

        if (nextSlot >= 4) {
          button.remove();
        }
      }


      function editCourse(button) {

        const card =
          button.closest(
            ".course-block"
          );

        card.querySelector(
          ".course-display"
        ).style.display = "none";

        card.querySelector(
          ".course-edit"
        ).style.display = "block";

        const firstInput =
          card.querySelector(
            ".edit-course-name"
          );

        if (firstInput) {
          firstInput.focus();
        }
      }


      function cancelCourseEdit(button) {

        const card =
          button.closest(
            ".course-block"
          );

        card.querySelector(
          ".course-edit"
        ).style.display = "none";

        card.querySelector(
          ".course-display"
        ).style.display = "";

        const saveButton =
          card.querySelector(
            ".course-save-button"
          );

        saveButton.disabled = false;

        saveButton.textContent =
          "Save";

        clearCourseMessage(card);
      }


      function showCourseMessage(
        card,
        message,
        isError
      ) {

        const element =
          card.querySelector(
            ".course-edit-message"
          );

        element.textContent =
          message;

        if (isError) {

          element.classList.add(
            "course-edit-error"
          );

          element.classList.remove(
            "course-edit-success"
          );

        } else {

          element.classList.add(
            "course-edit-success"
          );

          element.classList.remove(
            "course-edit-error"
          );

        }
      }


      function clearCourseMessage(card) {

        const element =
          card.querySelector(
            ".course-edit-message"
          );

        element.textContent = "";

        element.classList.remove(
          "course-edit-error",
          "course-edit-success"
        );
      }


      function openAddCourse() {

        const panel =
          document.getElementById(
            "add-course-panel"
          );

        panel.style.display =
          "flex";

        document.getElementById(
          "add-course-name"
        ).focus();
      }


      function closeAddCourse() {

        const panel =
          document.getElementById(
            "add-course-panel"
          );

        panel.style.display =
          "none";

        clearAddCourseForm();
      }


      function clearAddCourseForm() {

        document.getElementById(
          "add-school"
        ).value = "";

        document.getElementById(
          "add-course-name"
        ).value = "";

        document.getElementById(
          "add-day"
        ).value = "1";

        document.getElementById(
          "add-start-time"
        ).value = "";

        document.getElementById(
          "add-end-time"
        ).value = "";

        document.getElementById(
          "add-start-date"
        ).value = "";

        document.getElementById(
          "add-end-date"
        ).value = "";

        document.getElementById(
          "add-classroom"
        ).value = "";

        document.getElementById(
          "add-group"
        ).value = "";

        document.getElementById(
          "add-student-number"
        ).value = "";

        document.getElementById(
          "add-course-message"
        ).textContent = "";
      }


      function openAddSchool() {

        document.getElementById(
          "add-school-panel"
        ).style.display =
          "flex";

        document.getElementById(
          "add-school-name"
        ).focus();
      }


      function closeAddSchool() {

        document.getElementById(
          "add-school-panel"
        ).style.display =
          "none";

        document.getElementById(
          "add-school-name"
        ).value = "";

        document.getElementById(
          "add-school-message"
        ).textContent = "";
      }


      function deleteCourse(
        courseId,
        courseName
      ) {

        const confirmed =
          confirm(
            "Delete this course?\\n\\n" +
            courseName +
            "\\n\\n" +
            "This will permanently delete " +
            "the recurring course and its " +
            "teacher assignments."
          );

        if (!confirmed) {
          return;
        }

        fetch(
          "/delete-course",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },
            body:
              "course_id=" +
              encodeURIComponent(courseId)
          }
        )
          .then(response =>
            response.json()
          )
          .then(data => {

            if (data.success) {

              window.location.reload();

            } else {

              alert(
                data.message || 
                data.error ||
                "Failed to delete course."
              );

            }

          })
          .catch(error => {

            console.error(error);

            alert(
              "Failed to delete course."
            );

          });
      }

      function saveCourse(button) {

        const card =
          button.closest(
            ".course-block"
          );

        const courseId =
          card.dataset.courseId;

        const courseName =
          card.querySelector(
            ".edit-course-name"
          ).value.trim();

        const startTime =
          card.querySelector(
            ".edit-start-time"
          ).value;

        const endTime =
          card.querySelector(
            ".edit-end-time"
          ).value;

        const startDate =
          card.querySelector(
            ".edit-start-date"
          ).value;

        const endDate =
          card.querySelector(
            ".edit-end-date"
          ).value;

        const classroom =
          card.querySelector(
            ".edit-classroom"
          ).value.trim();

        const groupName =
          card.querySelector(
            ".edit-group"
          ).value.trim();

        const studentNumber =
          card.querySelector(
            ".edit-student-number"
          ).value;

        if (!courseName) {
          showCourseMessage(
            card,
            "Course name is required.",
            true
          );
          return;
        }

        if (!startTime || !endTime) {
          showCourseMessage(
            card,
            "Start time and end time are required.",
            true
          );
          return;
        }

        if (startTime >= endTime) {
          showCourseMessage(
            card,
            "End time must be after start time.",
            true
          );
          return;
        }

        if (
          startDate &&
          endDate &&
          startDate > endDate
        ) {
          showCourseMessage(
            card,
            "End date must be on or after start date.",
            true
          );
          return;
        }

        button.disabled = true;
        button.textContent = "Saving...";

        const formData =
          new FormData();

        formData.append(
          "course_id",
          courseId
        );

        formData.append(
          "course_name",
          courseName
        );

        formData.append(
          "start_time",
          startTime
        );

        formData.append(
          "end_time",
          endTime
        );

        formData.append(
          "start_date",
          startDate
        );

        formData.append(
          "end_date",
          endDate
        );

        formData.append(
          "classroom",
          classroom
        );

        formData.append(
          "group_name",
          groupName
        );

        formData.append(
          "student_number",
          studentNumber
        );

        fetch(
          "/update-course",
          {
            method: "POST",
            body: formData
          }
        )
          .then(response =>
            response.json()
          )
          .then(data => {

            if (!data.success) {

              showCourseMessage(
                card,
                data.message || 
                data.error ||
                  "Failed to update course.",
                true
              );

              button.disabled = false;
              button.textContent = "Save";

              return;
            }

            showCourseMessage(
              card,
              "Course updated successfully.",
              false
            );

            setTimeout(
              () => {
                window.location.reload();
              },
              500
            );

          })
          .catch(error => {

            console.error(error);

            showCourseMessage(
              card,
              "Failed to update course.",
              true
            );

            button.disabled = false;
            button.textContent = "Save";

          });
      }


      function saveNewCourse() 
      {

        const message =
          document.getElementById(
            "add-course-message"
          );

        const formData =
          new FormData();

        formData.append(
          "school_id",
          document.getElementById(
            "add-school"
          ).value
        );

        formData.append(
          "course_name",
          document.getElementById(
            "add-course-name"
          ).value.trim()
        );

        formData.append(
          "day_of_week",
          document.getElementById(
            "add-day"
          ).value
        );

        formData.append(
          "start_time",
          document.getElementById(
            "add-start-time"
          ).value
        );

        formData.append(
          "end_time",
          document.getElementById(
            "add-end-time"
          ).value
        );

        formData.append(
          "start_date",
          document.getElementById(
            "add-start-date"
          ).value
        );

        formData.append(
          "end_date",
          document.getElementById(
            "add-end-date"
          ).value
        );

        formData.append(
          "classroom",
          document.getElementById(
            "add-classroom"
          ).value.trim()
        );

        formData.append(
          "group_name",
          document.getElementById(
            "add-group"
          ).value.trim()
        );

        formData.append(
          "student_number",
          document.getElementById(
            "add-student-number"
          ).value
        );

        if (
          !formData.get("school_id") ||
          !formData.get("course_name") ||
          !formData.get("start_time") ||
          !formData.get("end_time")
        ) {

          message.textContent =
            "Please fill in all required fields.";

          message.className =
            "add-course-message add-course-error";

          return;
        }

        fetch(
          "/create-course",
          {
            method: "POST",
            body: formData
          }
        )
          .then(response =>
            response.json()
          )
          .then(data => {

            if (!data.success) {

              message.textContent =
                data.message || 
                data.error ||
                "Failed to create course.";

              message.className =
                "add-course-message add-course-error";

              return;
            }

            message.textContent =
              "Course created successfully.";

            message.className =
              "add-course-message add-course-success";

            setTimeout(
              () => {
                window.location.reload();
              },
              500
            );

          })
          .catch(error => {

            console.error(error);

            message.textContent =
              "Failed to create course.";

            message.className =
              "add-course-message add-course-error";

          });
      }


      function saveNewSchool() 
      {

        const message =
          document.getElementById(
            "add-school-message"
          );

        const schoolName =
          document.getElementById(
            "add-school-name"
          ).value.trim();

        if (!schoolName) {

          message.textContent =
            "School name is required.";

          message.className =
            "add-course-message add-course-error";

          return;
        }

        const formData =
          new FormData();

        formData.append(
          "name",
          schoolName
        );

        fetch(
          "/create-school",
          {
            method: "POST",
            body: formData
          }
        )
          .then(response =>
            response.json()
          )
          .then(data => {

            if (!data.success) {

              message.textContent =
                data.message || 
                data.error ||
                "Failed to create school.";

              message.className =
                "add-course-message add-course-error";

              return;
            }

            message.textContent =
              "School created successfully.";

            message.className =
              "add-course-message add-course-success";

            setTimeout(
              () => {
                window.location.reload();
              },
              500
            );

          })
          .catch(error => {

            console.error(error);

            message.textContent =
              "Failed to create school.";

            message.className =
              "add-course-message add-course-error";

          });
      }

      function openManageSchools() 
      {

        const panel =
          document.getElementById(
            "manage-schools-panel"
          );

        if (!panel) {
          console.error(
            "Manage Schools panel not found."
          );
          return;
        }

        panel.style.display = "flex";

        const list =
          document.getElementById(
            "manage-schools-list"
          );

        if (!list) {
          console.error(
            "Manage Schools list not found."
          );
          return;
        }

        list.innerHTML =
          '<div class="add-course-message">' +
          'Loading schools...' +
          '</div>';

        fetch("/manage-schools")
          .then(function(response) {

            if (!response.ok) {
              throw new Error(
                "HTTP " + response.status
              );
            }

            return response.json();
          })
          .then(function(data) {

            if (!data.success) {

              list.innerHTML =
                '<div class="add-course-message">' +
                (
                  data.message ||
                  "Failed to load schools."
                ) +
                '</div>';

              return;
            }

            list.innerHTML = "";

            data.schools.forEach(
              function(school) {

                const row =
                  document.createElement("div");

                row.className =
                  "manage-school-row";

                row.dataset.schoolId =
                  String(school.id);

                // School name
                const name =
                  document.createElement("div");

                name.className =
                  "manage-school-name";

                name.textContent =
                  String(school.name || "");

                // Status
                const status =
                  document.createElement("select");

                status.className =
                  "manage-school-status";

                const activeOption =
                  document.createElement("option");

                activeOption.value =
                  "active";

                activeOption.textContent =
                  "Active";

                const hiddenOption =
                  document.createElement("option");

                hiddenOption.value =
                  "hidden";

                hiddenOption.textContent =
                  "Hidden";

                status.appendChild(
                  activeOption
                );

                status.appendChild(
                  hiddenOption
                );

                status.value =
                  school.status === "hidden"
                    ? "hidden"
                    : "active";

                // Background color
                const background =
                  document.createElement("input");

                background.type =
                  "color";

                background.className =
                  "manage-school-background";

                background.value =
                  school.background_color ||
                  "#ffffff";

                background.title =
                  "Background color";

                // Border color
                const border =
                  document.createElement("input");

                border.type =
                  "color";

                border.className =
                  "manage-school-border";

                border.value =
                  school.border_color ||
                  "#000000";

                border.title =
                  "Border color";

                row.appendChild(name);
                row.appendChild(status);
                row.appendChild(background);
                row.appendChild(border);

                list.appendChild(row);
              }
            );

          })
          .catch(function(error) {

            console.error(
              "Failed to load schools:",
              error
            );

            list.innerHTML =
              '<div class="add-course-message">' +
              'Failed to load schools.' +
              '</div>';

          });
      }
      function saveSchools() 
      {

        const list =
          document.getElementById(
            "manage-schools-list"
          );

        const message =
          document.getElementById(
            "manage-schools-message"
          );

        if (!list) {
          return;
        }

        const rows =
          list.querySelectorAll(
            ".manage-school-row"
          );

        if (!rows.length) {
          return;
        }

        const requests = [];

        rows.forEach(function(row) {

          const schoolId =
            row.dataset.schoolId;

          const status =
            row.querySelector(
              ".manage-school-status"
            ).value;

          const backgroundColor =
            row.querySelector(
              ".manage-school-background"
            ).value;

          const borderColor =
            row.querySelector(
              ".manage-school-border"
            ).value;

          const formData =
            new FormData();

          formData.append(
            "school_id",
            schoolId
          );

          formData.append(
            "status",
            status
          );

          formData.append(
            "background_color",
            backgroundColor
          );

          formData.append(
            "border_color",
            borderColor
          );

          requests.push(
            fetch(
              "/update-school",
              {
                method: "POST",
                body: formData
              }
            )
              .then(function(response) {
                return response.json();
              })
          );
        });

        Promise.all(requests)
          .then(function(results) {

            const failed =
              results.find(
                function(result) {
                  return !result.success;
                }
              );

            if (failed) {

              if (message) {
                message.style.display = "block";
                message.textContent =
                  failed.message ||
                  "Failed to update schools.";
              }

              return;
            }

            if (message) {
              message.style.display = "block";
              message.textContent =
                "Schools updated successfully.";
            }

            /*
            * Reload after a short delay so that
            * hidden schools disappear from the
            * Add Course school list immediately.
            */
            setTimeout(
              function() {
                window.location.reload();
              },
              500
            );

          })
          .catch(function(error) {

            console.error(
              "Failed to update schools:",
              error
            );

            if (message) {
              message.style.display = "block";
              message.textContent =
                "Failed to update schools.";
            }

          });
      }
      function closeManageSchools() {

        const panel =
          document.getElementById(
            "manage-schools-panel"
          );

        if (panel) {
          panel.style.display = "none";
        }

      }

      function openSchoolHoliday() {

        document.getElementById(
          "school-holiday-panel"
        ).style.display =
          "flex";
      }


      function closeSchoolHoliday() {

        document.getElementById(
          "school-holiday-panel"
        ).style.display =
          "none";
      }


      function toggleExceptionCourse() {

        const selected =
          document.querySelector(
            'input[name="scope"]:checked'
          );

        if (!selected) {
          return;
        }

        const scope =
          selected.value;

        const courseField =
          document.getElementById(
            "exception-course-field"
          );

        if (scope === "course") {

          courseField.style.display =
            "block";

          updateExceptionCourses();

        } else {

          courseField.style.display =
            "none";

          document.getElementById(
            "exception-course"
          ).value = "";
        }
      }


      function updateExceptionCourses() {

        const schoolSelect =
          document.getElementById(
            "exception-school"
          );

        const startDateInput =
          document.getElementById(
            "exception-start-date"
          );

        const endDateInput =
          document.getElementById(
            "exception-end-date"
          );

        const courseSelect =
          document.getElementById(
            "exception-course"
          );

        if (
          !schoolSelect ||
          !startDateInput ||
          !endDateInput ||
          !courseSelect
        ) {
          return;
        }

        const schoolId =
          schoolSelect.value;

        const startDate =
          startDateInput.value;

        const endDate =
          endDateInput.value;

        courseSelect.innerHTML = "";

        const defaultOption =
          document.createElement(
            "option"
          );

        defaultOption.value = "";

        defaultOption.textContent =
          "Select a course";

        courseSelect.appendChild(
          defaultOption
        );

        if (
          !schoolId ||
          !startDate ||
          !endDate
        ) {
          return;
        }

        if (endDate < startDate) {
          return;
        }

        const selectedStart =
          new Date(
            startDate + "T00:00:00"
          );

        const selectedEnd =
          new Date(
            endDate + "T00:00:00"
          );

        const matchingCourses =
          exceptionCourseData.filter(
            function (course) {

              if (
                String(
                  course.schoolId
                ) !==
                String(
                  schoolId
                )
              ) {
                return false;
              }

              if (course.startDate) {

                const courseStart =
                  new Date(
                    course.startDate +
                    "T00:00:00"
                  );

                if (
                  courseStart >
                  selectedEnd
                ) {
                  return false;
                }
              }

              if (course.endDate) {

                const courseEnd =
                  new Date(
                    course.endDate +
                    "T00:00:00"
                  );

                if (
                  courseEnd <
                  selectedStart
                ) {
                  return false;
                }
              }

              let current =
                new Date(
                  selectedStart
                );

              while (
                current <=
                selectedEnd
              ) {

                const jsWeekday =
                  current.getDay();

                const weekday =
                  jsWeekday === 0
                    ? 7
                    : jsWeekday;

                if (
                  weekday ===
                  course.dayOfWeek
                ) {
                  return true;
                }

                current.setDate(
                  current.getDate() + 1
                );
              }

              return false;
            }
          );

        const weekdayNames = [
          "",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday"
        ];

        matchingCourses.forEach(
          function (course) {

            const option =
              document.createElement(
                "option"
              );

            option.value =
              course.id;

            let text =
              weekdayNames[
                course.dayOfWeek
              ];

            if (
              course.startTime &&
              course.endTime
            ) {

              text +=
                " " +
                course.startTime +
                "–" +
                course.endTime;
            }

            text +=
              " — " +
              course.courseName;

            if (course.groupName) {

              text +=
                " — " +
                course.groupName;
            }

            option.textContent =
              text;

            courseSelect.appendChild(
              option
            );
          }
        );
      }


      document.addEventListener(
        "DOMContentLoaded",
        function () {

          const schoolSelect =
            document.getElementById(
              "exception-school"
            );

          const startDateInput =
            document.getElementById(
              "exception-start-date"
            );

          const endDateInput =
            document.getElementById(
              "exception-end-date"
            );

          if (schoolSelect) {

            schoolSelect.addEventListener(
              "change",
              updateExceptionCourses
            );
          }

          if (startDateInput) {

            startDateInput.addEventListener(
              "change",
              updateExceptionCourses
            );
          }

          if (endDateInput) {

            endDateInput.addEventListener(
              "change",
              updateExceptionCourses
            );
          }

        }
      );

    </script>
  `);
}