import { handleView } from "./view";
import { handleTeacher } from "./teacher";
import { handleEdit } from "./edit";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ========== Home ==========
    if (url.pathname === "/") {
      return Response.redirect(url.origin + "/view", 302);
    }

    // ========== View schedule ==========
    if (url.pathname === "/view") {
      return handleView(request, env);
    }

    // ========== Teacher schedule / management ==========
    if (
      url.pathname === "/teachers" ||
      /^\/teachers\/\d+$/.test(url.pathname) ||
      url.pathname === "/delete-teacher" ||
      url.pathname === "/create-teacher" ||
      url.pathname === "/create-teacher-leave" ||
      url.pathname === "/delete-teacher-leave" ||
      url.pathname === "/update-teacher-workdays"
    ) {
      return handleTeacher(request, env);
    }

    // ========== Edit schedule ==========
    if (
      url.pathname === "/edit" ||
      url.pathname === "/save-assignments" ||
      url.pathname === "/create-schedule-exception" ||
      url.pathname === "/delete-schedule-exception" ||
      url.pathname === "/create-course" ||
      url.pathname === "/create-school" ||
      url.pathname === "/update-course" ||
      url.pathname === "/delete-course" ||
      url.pathname === "/manage-schools" ||
      url.pathname === "/update-school" ||
      url.pathname === "/toggle-pending-teacher"
    ) {
      return handleEdit(request, env);
    }

    // Other paths go to static assets.
    return env.ASSETS.fetch(request);
  }
};
