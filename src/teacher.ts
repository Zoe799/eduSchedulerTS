import { html, formatDate, formatTime, escapeHtml, escapeJsString, renderPage } from "./shared";

export async function handleTeacher(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
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
      const printMode =
        url.searchParams.get("print") === "1";
      // =========================================================
      // 1. Determine selected date range
      // =========================================================

      const startDateParam =
        url.searchParams.get("start_date");

      const endDateParam =
        url.searchParams.get("end_date");

      let selectedStartDate = new Date();
      let selectedEndDate = new Date();

      if (startDateParam) {
        const parsed =
          new Date(startDateParam + "T12:00:00");

        if (!isNaN(parsed.getTime())) {
          selectedStartDate = parsed;
        }
      }

      if (endDateParam) {
        const parsed =
          new Date(endDateParam + "T12:00:00");

        if (!isNaN(parsed.getTime())) {
          selectedEndDate = parsed;
        }
      }


      // =========================================================
      // 2. Calculate full Monday - Saturday range
      // =========================================================

      const startDayOfWeek =
        selectedStartDate.getDay();

      const startMondayOffset =
        startDayOfWeek === 0
          ? -6
          : 1 - startDayOfWeek;

      const rangeStart =
        new Date(selectedStartDate);

      rangeStart.setDate(
        selectedStartDate.getDate() +
        startMondayOffset
      );


      const endDayOfWeek =
        selectedEndDate.getDay();

      const endMondayOffset =
        endDayOfWeek === 0
          ? -6
          : 1 - endDayOfWeek;

      const rangeEnd =
        new Date(selectedEndDate);

      rangeEnd.setDate(
        selectedEndDate.getDate() +
        endMondayOffset +
        5
      );


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
            formatDate(rangeEnd),
            formatDate(rangeStart)
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
          .bind(formatDate(rangeEnd))
          .all();

      const weeklyAssignments =
        weeklyRows as any[];

      // =========================================================
      // 8. Build exact assignment map
      // =========================================================

      const weeklyAssignmentMap =
        new Map<string, number[]>();

      for (const item of weeklyAssignments) {

        const key =
          `${item.course_id}_${item.class_date}`;

        if (!weeklyAssignmentMap.has(key)) {
          weeklyAssignmentMap.set(key, []);
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


      // =========================================================
      // 9. Build inherited assignment map
      //
      // For every course + weekday:
      // find assignment dates and make each assignment
      // effective until the next assignment date.
      //
      // Example:
      //
      // 2026-10-05 -> [3, 1]
      // 2026-10-12 -> [22, 13]
      //
      // Then:
      //
      // 2026-10-05 -> [3, 1]
      // 2026-10-19 -> [22, 13]
      // 2026-10-26 -> [22, 13]
      // 2026-11-02 -> [22, 13]
      // ...
      // =========================================================

      const inheritedAssignmentMap =
        new Map<string, number[]>();


      // Group weekly assignments by course + weekday
      const assignmentHistory =
        new Map<string, {
          date: string;
          teacherIds: number[];
        }[]>();


      for (const item of weeklyAssignments) {

        if (item.teacher_id === null) {
          continue;
        }

        const itemDate =
          new Date(
            item.class_date + "T12:00:00"
          );

        const weekday =
          itemDate.getDay();

        // Ignore Sunday
        if (weekday === 0) {
          continue;
        }

        const historyKey =
          `${item.course_id}_${weekday}`;

        if (!assignmentHistory.has(historyKey)) {
          assignmentHistory.set(
            historyKey,
            []
          );
        }

        const history =
          assignmentHistory.get(historyKey)!;


        // Find an existing record for the same date
        let record =
          history.find(
            x => x.date === item.class_date
            );


          if (!record) {

            record = {
              date: item.class_date,
              teacherIds: []
            };

            history.push(record);
          }


          // Maximum 4 teachers
          if (
            record.teacherIds.length < 4
          ) {
            record.teacherIds.push(
              Number(item.teacher_id)
            );
          }
        }


        // Sort every course's assignment history
        // from oldest → newest
        for (const [
          historyKey,
          history
        ] of assignmentHistory.entries()) {

          history.sort(
            (a, b) =>
              a.date.localeCompare(b.date)
          );


          // We need the course id separately
          const parts =
            historyKey.split("_");

          const courseId =
            Number(parts[0]);


          // Create inherited entries for
          // every assignment period.
          //
          // IMPORTANT:
          // We intentionally do NOT create entries
          // for the assignment date itself.
          // The exact assignment map handles that.
          //
          // The assignment remains effective until
          // another assignment for the same course
          // and weekday appears.

          for (
            let i = 0;
            i < history.length;
            i++
          ) {

            const current =
              history[i];

            const next =
              history[i + 1];


            // Determine the first date on which
            // this assignment should be inherited.
            //
            // If there is a next assignment,
            // inheritance starts from the next week.
            //
            // If there is no next assignment,
            // inheritance continues indefinitely.

            const currentDate =
              new Date(
                current.date + "T12:00:00"
              );

            let inheritedDate =
              new Date(currentDate);

            inheritedDate.setDate(
              inheritedDate.getDate() + 7
            );


            while (
              inheritedDate <= rangeEnd
            ) {

              const dateString =
                formatDate(inheritedDate);


              // Stop when we reach the next
              // explicit assignment.
              if (
                next &&
                dateString >= next.date
              ) {
                break;
              }


              // Only create entries inside
              // the currently displayed range.
              if (
                dateString >=
                  formatDate(rangeStart) &&
                dateString <=
                  formatDate(rangeEnd)
              ) {

                const key =
                  `${courseId}_${dateString}`;

                inheritedAssignmentMap.set(
                  key,
                  [...current.teacherIds]
                );
              }


              inheritedDate.setDate(
                inheritedDate.getDate() + 7
              );
            }
          }
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
              end_date,
              reason
            FROM schedule_exceptions
            WHERE start_date <= ?
              AND end_date >= ?
          `)
          .bind(
            formatDate(rangeEnd),
            formatDate(rangeStart)
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

      const currentDate =
        new Date(rangeStart);

      while (
        currentDate <= rangeEnd
      ) {

        const dateString =
          formatDate(currentDate);

        if (currentDate.getDay() === 0) {
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }

        const weekday = currentDate.getDay();

        const dayCourses: any[] = [];


        // -------------------------------------------------------
        // Find courses for this day
        // -------------------------------------------------------

        for (
          const course of courses
        ) {

          // =====================================================
          // Course must be active on this specific date
          // =====================================================

          if (
            course.start_date &&
            dateString < course.start_date
          ) {
            continue;
          }

          if (
            course.end_date &&
            dateString > course.end_date
          ) {
            continue;
          }

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

          let teacherIds: number[] = [];

          let assignmentSource =
            "default";

          if (
            weeklyAssignmentMap.has(exactKey)
          ) {

            teacherIds =
              weeklyAssignmentMap.get(exactKey) || [];

            assignmentSource =
              "weekly";

          } else if (
            inheritedAssignmentMap.has(exactKey)
          ) {

            teacherIds =
              inheritedAssignmentMap.get(exactKey) || [];

            assignmentSource =
              "inherited";

          } else {

            teacherIds = [];

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

            id:
              course.id,

            school_id:
              course.school_id,

            school_name:
              course.school_name,

            course_name:
              course.course_name,
            
            start_date: course.start_date,
            end_date: course.end_date,
            day_of_week:
              course.day_of_week,

            start_time_display:
              formatTime(
                course.start_time
              ),

            end_time_display:
              formatTime(
                course.end_time
              ),

            classroom:
              course.classroom,

            group_name:
              course.group_name,

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
        // Sort courses
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


        // -------------------------------------------------------
        // Add this day
        // -------------------------------------------------------

        days.push({

          date:
            new Date(currentDate),

          courses:
            dayCourses

        });


        // -------------------------------------------------------
        // Move to next day
        // -------------------------------------------------------

        currentDate.setDate(
          currentDate.getDate() + 1
        );

      }



      // =========================================================
      // 12. Render
      // =========================================================

      if (printMode) {

        return html(
          renderTeacherPrintPage({
            teacher,
            days,
            exceptions,
            range_start: rangeStart,
            range_end: rangeEnd
          })
        );

      }

      return html(
        renderTeacherSchedulePage({
          teacher,
          teachers,
          teacher_id: teacherId,
          days,

          range_start: rangeStart,
          range_end: rangeEnd,

          selected_start_date: selectedStartDate,
          selected_end_date: selectedEndDate
        })
      );
    }

}

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

// =========================================================
// Teacher Print View
// =========================================================

function renderTeacherPrintPage({
  teacher,
  days,
  exceptions,
  range_start,
  range_end
}: {
  teacher: any;
  days: any[];
  exceptions: any[];
  range_start: Date;
  range_end: Date;
}): string {

  const dayNames = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ];


  // =======================================================
  // Date helpers
  // =======================================================

  function formatLongDate(
    date: Date
  ): string {

    return date.toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric"
      }
    );

  }


  function formatShortDate(
    dateString: string
  ): string {

    const date =
      new Date(
        dateString + "T12:00:00"
      );

    return date.toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric"
      }
    );

  }


  function formatCoursePeriod(
    start: string | null,
    end: string | null
  ): string {

    if (!start && !end) {
      return "Not specified";
    }

    if (!start) {
      return "Until " +
        formatShortDate(end!);
    }

    if (!end) {
      return "From " +
        formatShortDate(start);
    }

    return (
      formatShortDate(start) +
      " – " +
      formatShortDate(end)
    );

  }


  // =======================================================
  // Get exception dates for one course
  // =======================================================

  function getExceptionDates(
    course: any
  ): {
    date: string;
    reason: string;
  }[] {

    const result: {
      date: string;
      reason: string;
    }[] = [];


    const courseWeekday =
      Number(course.day_of_week);


    const queryStart =
      formatDate(range_start);

    const queryEnd =
      formatDate(range_end);


    const courseStart =
      course.start_date ||
      queryStart;

    const courseEnd =
      course.end_date ||
      queryEnd;


    // Intersection of:
    //
    // query range
    // course lifetime
    //
    const effectiveStart =
      courseStart > queryStart
        ? courseStart
        : queryStart;

    const effectiveEnd =
      courseEnd < queryEnd
        ? courseEnd
        : queryEnd;


    if (
      effectiveStart >
      effectiveEnd
    ) {
      return result;
    }


    for (
      const exception of exceptions
    ) {

      const sameSchool =
        Number(exception.school_id) ===
        Number(course.school_id);


      const sameCourse =
        exception.course_id === null ||
        Number(exception.course_id) ===
        Number(course.id);


      if (
        !sameSchool ||
        !sameCourse
      ) {
        continue;
      }


      let currentDate =
        new Date(
          exception.start_date +
          "T12:00:00"
        );


      const exceptionEnd =
        new Date(
          exception.end_date +
          "T12:00:00"
        );


      while (
        currentDate <= exceptionEnd
      ) {

        const dateString =
          formatDate(currentDate);


        // Only dates that:
        //
        // 1. are inside the course lifetime
        // 2. are inside selected print range
        // 3. match the course weekday
        //
        if (
          dateString >= effectiveStart &&
          dateString <= effectiveEnd
        ) {

          const jsDay =
            currentDate.getDay();


          const weekday =
            jsDay === 0
              ? 7
              : jsDay;


          if (
            weekday === courseWeekday
          ) {

            result.push({
              date: dateString,
              reason:
                exception.reason ||
                "No class"
            });

          }

        }


        currentDate.setDate(
          currentDate.getDate() + 1
        );

      }

    }


    // Remove duplicates
    const unique =
      new Map<
        string,
        {
          date: string;
          reason: string;
        }
      >();


    for (
      const item of result
    ) {

      unique.set(
        item.date,
        item
      );

    }


    return Array.from(
      unique.values()
    ).sort(
      (a, b) =>
        a.date.localeCompare(b.date)
    );

  }


  // =======================================================
  // Compress consecutive weekly exception dates
  //
  // Example:
  //
  // Sep 30
  // Oct 7
  // Oct 14
  //
  // becomes:
  //
  // Sep 30 – Oct 14
  // =======================================================

  function compressExceptionDates(
    items: {
      date: string;
      reason: string;
    }[]
  ): {
    start: string;
    end: string;
    reason: string;
  }[] {

    if (
      items.length === 0
    ) {
      return [];
    }


    const result: {
      start: string;
      end: string;
      reason: string;
    }[] = [];


    let group = {
      start: items[0].date,
      end: items[0].date,
      reason: items[0].reason
    };


    for (
      let i = 1;
      i < items.length;
      i++
    ) {

      const previous =
        new Date(
          group.end +
          "T12:00:00"
        );


      const current =
        new Date(
          items[i].date +
          "T12:00:00"
        );


      const diff =
        (
          current.getTime() -
          previous.getTime()
        ) /
        (
          1000 *
          60 *
          60 *
          24
        );


      if (
        diff === 7 &&
        items[i].reason ===
          group.reason
      ) {

        group.end =
          items[i].date;

      } else {

        result.push(group);

        group = {
          start: items[i].date,
          end: items[i].date,
          reason: items[i].reason
        };

      }

    }


    result.push(group);


    return result;

  }


  // =======================================================
  // Collect unique courses
  // =======================================================

  const scheduleMap =
    new Map<string, any>();


  for (
    const day of days
  ) {

    if (
      !day.courses ||
      day.courses.length === 0
    ) {
      continue;
    }


    for (
      const course of day.courses
    ) {

      const weekday =
        Number(course.day_of_week);


      const key = [
        course.id,
        weekday,
        course.start_time_display,
        course.end_time_display,
        course.school_name,
        course.course_name,
        course.classroom || "",
        course.group_name || ""
      ].join("|");


      if (
        !scheduleMap.has(key)
      ) {

        scheduleMap.set(
          key,
          {
            ...course,

            weekday,

            dayName:
              dayNames[
                weekday - 1
              ]
          }
        );

      }

    }

  }


  const schedule =
    Array.from(
      scheduleMap.values()
    );


  // =======================================================
  // Sort
  // =======================================================

  schedule.sort(
    (a, b) => {

      if (
        a.weekday !==
        b.weekday
      ) {

        return (
          a.weekday -
          b.weekday
        );

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


      return (
        a.school_name || ""
      ).localeCompare(
        b.school_name || ""
      );

    }
  );


  // =======================================================
  // Build table
  // =======================================================

  const tableRows =
    schedule.length > 0

      ? schedule.map(course => {

          const exceptionDates =
            getExceptionDates(
              course
            );


          const exceptionGroups =
            compressExceptionDates(
              exceptionDates
            );


          const noClassHtml =
            exceptionGroups.length > 0

              ? `
                <div class="no-class">

                  <strong>
                    No class:
                  </strong>

                  ${exceptionGroups
                    .map(item => {

                      const dateText =
                        item.start ===
                        item.end

                          ? formatShortDate(
                              item.start
                            )

                          : (
                              formatShortDate(
                                item.start
                              ) +
                              " – " +
                              formatShortDate(
                                item.end
                              )
                            );


                      return `
                        <span class="exception-item">
                          ${escapeHtml(
                            dateText
                          )}

                          ${
                            item.reason
                              ? ` — ${escapeHtml(
                                  item.reason
                                )}`
                              : ""
                          }
                        </span>
                      `;

                    })
                    .join("; ")}

                </div>
              `

              : "";


          return `

            <tr>

              <td class="day-cell">

                ${escapeHtml(
                  course.dayName
                )}

              </td>


              <td class="time-cell">

                ${escapeHtml(
                  course.start_time_display
                )}

                –

                ${escapeHtml(
                  course.end_time_display
                )}

              </td>


              <td>

                <strong>

                  ${escapeHtml(
                    course.school_name
                  )}

                </strong>

              </td>


              <td>

                ${escapeHtml(
                  course.course_name
                )}

                ${
                  course.group_name
                    ? `
                      <div class="sub-info">

                        ${escapeHtml(
                          course.group_name
                        )}

                      </div>
                    `
                    : ""
                }

                ${
                  course.student_number !==
                    null &&
                  course.student_number !==
                    undefined
                    ? `
                      <div class="sub-info">

                        ${escapeHtml(
                          String(
                            course.student_number
                          )
                        )}
                        kids

                      </div>
                    `
                    : ""
                }


                <div class="course-period">

                  <strong>
                    Course period:
                  </strong>

                  ${escapeHtml(
                    formatCoursePeriod(
                      course.start_date,
                      course.end_date
                    )
                  )}

                </div>


                ${noClassHtml}

              </td>


              <td>

                ${
                  course.classroom
                    ? escapeHtml(
                        course.classroom
                      )
                    : "—"
                }

              </td>

            </tr>

          `;

        }).join("")

      : `

          <tr>

            <td
              colspan="5"
              class="no-classes"
            >

              No classes scheduled

            </td>

          </tr>

        `;


  // =======================================================
  // Render page
  // =======================================================

  return `

<!DOCTYPE html>

<html lang="en">

<head>

  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>

    ${escapeHtml(
      teacher.name
    )}

    - Teacher Schedule

  </title>


  <style>

    * {
      box-sizing: border-box;
    }


    body {

      margin: 0;

      padding: 32px;

      font-family:
        Arial,
        Helvetica,
        sans-serif;

      color: #222;

      background: white;

    }


    .print-container {

      max-width: 1100px;

      margin: 0 auto;

    }


    .header {

      display: flex;

      justify-content:
        space-between;

      align-items:
        flex-start;

      margin-bottom: 28px;

      border-bottom:
        2px solid #222;

      padding-bottom: 16px;

    }


    .title {

      margin: 0;

      font-size: 28px;

      font-weight: 700;

    }


    .date-range {

      margin-top: 6px;

      font-size: 14px;

      color: #666;

    }


    .teacher-name {

      text-align: right;

      font-size: 15px;

      color: #555;

    }


    table {

      width: 100%;

      border-collapse:
        collapse;

      font-size: 14px;

    }


    th {

      text-align: left;

      padding: 10px 12px;

      background: #f1f1f1;

      border-bottom:
        2px solid #333;

      font-weight: 700;

    }


    td {

      padding: 11px 12px;

      border-bottom:
        1px solid #ddd;

      vertical-align:
        top;

    }


    .day-cell {

      width: 100px;

      font-weight: 700;

    }


    .time-cell {

      width: 130px;

      white-space:
        nowrap;

      font-weight: 600;

    }


    .sub-info {

      margin-top: 4px;

      font-size: 12px;

      color: #777;

    }


    .course-period {

      margin-top: 8px;

      font-size: 12px;

      color: #555;

    }


    .no-class {

      margin-top: 6px;

      font-size: 12px;

      color: #a33;

      line-height: 1.5;

    }


    .exception-item {

      white-space:
        nowrap;

    }


    .no-classes {

      text-align: center;

      padding: 30px;

      color: #777;

    }


    .footer {

      margin-top: 24px;

      font-size: 11px;

      color: #888;

      text-align: right;

    }


    .print-button {

      position: fixed;

      top: 20px;

      right: 20px;

      padding: 9px 16px;

      border: none;

      border-radius: 6px;

      background: #222;

      color: white;

      cursor: pointer;

      font-size: 13px;

    }


    @media print {

      body {

        padding: 0;

      }


      .print-container {

        max-width: none;

      }


      .print-button {

        display: none;

      }


      table {

        page-break-inside:
          auto;

      }


      tr {

        page-break-inside:
          avoid;

        page-break-after:
          auto;

      }

    }

  </style>

</head>


<body>


<button
  class="print-button"
  onclick="window.print()"
>

  Print / Save as PDF

</button>


<div class="print-container">


  <div class="header">

    <div>

      <h1 class="title">

        Teacher Schedule

      </h1>


      <div class="date-range">

        ${formatLongDate(
          range_start
        )}

        –

        ${formatLongDate(
          range_end
        )}

      </div>

    </div>


    <div class="teacher-name">

      ${escapeHtml(
        teacher.name
      )}

    </div>

  </div>


  <table>

    <thead>

      <tr>

        <th>Day</th>

        <th>Time</th>

        <th>School</th>

        <th>Course</th>

        <th>Room</th>

      </tr>

    </thead>


    <tbody>

      ${tableRows}

    </tbody>

  </table>


  <div class="footer">

    EduScheduler

  </div>


</div>


</body>

</html>

  `;

}

// ========== 查看教师课表 （teacher/id.html）
function renderTeacherSchedulePage({
  teacher,
  teachers,
  teacher_id,
  days,
  range_start,
  range_end,
  selected_start_date,
  selected_end_date
}: {
  teacher: any;
  teachers: any[];
  teacher_id: number;
  days: any[];
  range_start: Date;
  range_end: Date;
  selected_start_date: Date;
  selected_end_date: Date;
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

        </div>


        <!-- =========================================
             Controls
             ========================================= -->

        <div class="schedules-controls">

          <div class="date-selector">

            <label>
              From
              <input
                type="date"
                id="start-date"
                value="${formatDate(selected_start_date)}"
                onchange="changeDateRange()"
              >
            </label>


            <label>
              To
              <input
                type="date"
                id="end-date"
                value="${formatDate(selected_end_date)}"
                onchange="changeDateRange()"
              >
            </label>

            <button
              type="button"
              onclick="applyDateRange()"
              class="date-seclector"
            >
              Go
            </button>

            <a
              href="/teachers/${teacher_id}?start_date=${formatDate(range_start)}&end_date=${formatDate(range_end)}&print=1"
              target="_blank"
              class="print-view-button"
            >
              🖨 Print View
            </a>
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
      function applyDateRange() {
        const startDate =
          document.getElementById("start-date").value;

        const endDate =
          document.getElementById("end-date").value;

        if (!startDate || !endDate) {
          return;
        }

        if (endDate < startDate) {
          alert("End date cannot be before start date.");
          return;
        }

        const params = new URLSearchParams();

        params.set("start_date", startDate);
        params.set("end_date", endDate);

        window.location.href =
          window.location.pathname +
          "?" +
          params.toString();
      }
      
      function changeTeacher() {

        const selector =
          document.getElementById(
            "teacher-selector"
          );

        const teacherId =
          selector.value;

        const startDate =
          "${formatDate(selected_start_date)}";

        const endDate =
          "${formatDate(selected_end_date)}";

        window.location.href =
          "/teachers/"
          + teacherId
          + "?start_date="
          + startDate
          + "&end_date="
          + endDate;
      }

      function changeDateRange() {

        const startDate =
          document.getElementById(
            "start-date"
          ).value;

        const endDate =
          document.getElementById(
            "end-date"
          ).value;

        if (!startDate || !endDate) {
          return;
        }

        if (startDate > endDate) {
          alert(
            "The start date cannot be after the end date."
          );
          return;
        }

        window.location.href =
          "/teachers/${teacher_id}"
          + "?start_date="
          + startDate
          + "&end_date="
          + endDate;
      }

    </script>

  `);
}

