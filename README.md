> 🚀 **当前版本 / Current Version**
>
> 这是 EduScheduler 的当前版本。本项目已经从最初的 **Python / FastAPI + MySQL** 架构迁移到 **TypeScript + Cloudflare Workers + Cloudflare D1**。
>
> This is the current version of EduScheduler. The project has been migrated from the original **Python / FastAPI + MySQL** implementation to **TypeScript + Cloudflare Workers + Cloudflare D1**.
>
> 旧版 Python 项目仍然保留，作为早期版本和项目文档参考。  
> The original Python version is still available as a reference for the earlier implementation and documentation.
>
> **👉 [EduScheduler – Python / FastAPI + MySQL](https://github.com/Zoe799/EduScheduler)**


# EduScheduler

**教育课程与教师排课管理系统**
**A Scheduling System for Multi-School Education Programs**

> A web-based scheduling system designed for education programs where teachers, courses, and resources are shared across multiple schools.

> 🚀 **Current Version**
>
> This is the current TypeScript version of EduScheduler, migrated from the original **Python / FastAPI + MySQL** implementation to **TypeScript + Cloudflare Workers + Cloudflare D1**.
>
> The original Python version is still available as a reference:
>
> **[EduScheduler – Python / FastAPI + MySQL](https://github.com/Zoe799/EduScheduler)**

---

## 💡 Why EduScheduler?

### 为什么不是使用现有排课系统？

**中文**

EduScheduler 是为了适应一个比较特殊的实际工作场景。

我们的课程安排涉及 **多个学校、多个校区，以及一批需要在不同学校之间流动的教师**。

例如，一名教师可能在：

```text
14:00–14:30   School A
14:30–15:30   School B
```

也可能出现课程时间存在部分重叠的情况：

```text
14:00–15:00   School A
14:30–15:30   School B
```

这种情况下，系统需要发现潜在的时间冲突，但不能简单地认为：

> “一个老师同时出现在两个课程中 = 排课错误。”

实际的排课工作仍然需要由工作人员根据课程地点、移动时间和具体情况进行判断。

因此，系统会对教师时间冲突和请假等情况提供 **warnings**，而不是强制阻止排课。

此外，我们的课程安排还存在一些通用排课软件不一定能够很好适应的需求：

* 同一批教师需要跨多个学校授课
* 不同学校拥有独立的假期和不上课日期
* 常规课程安排与某一周实际的教师安排可能不同
* 教师拥有自己的工作日和请假记录
* 一门课程可能由多名教师共同负责
* 排课人员需要在发现异常后保留人工判断和调整的空间

EduScheduler 因此被设计成一个面向实际工作流程的 **multi-school scheduling system**，而不仅仅是一张电子课表。

---

### Why build another scheduling system?

**English**

EduScheduler was built to fit a specific real-world workflow.

Our teaching schedule involves **multiple schools, multiple locations, and a shared pool of teachers who move between schools**.

For example, a teacher may have:

```text
14:00–14:30   School A
14:30–15:30   School B
```

There may also be situations where course times partially overlap:

```text
14:00–15:00   School A
14:30–15:30   School B
```

In such cases, the system should identify the potential conflict, but it should not automatically assume that the schedule is invalid.

The scheduler may need to consider factors such as travel time, classroom arrangements, and the actual circumstances of the classes.

Therefore, one of the core design principles of EduScheduler is:

> **Identify potential problems without making scheduling decisions for people.**

The system provides **warnings** for teacher scheduling conflicts and leave, rather than simply blocking the assignment.

Other requirements that shaped the system include:

* Teachers may work across multiple schools
* Each school has its own holidays and non-class days
* Regular course schedules may differ from actual weekly teacher assignments
* Teachers have individual working days and leave
* A course may have multiple teachers
* Scheduling staff need to retain the ability to review and adjust unusual cases manually

EduScheduler is therefore designed as a **multi-school scheduling system built around a real operational workflow**, rather than simply a digital timetable.

---

# ✨ Key Features | 主要功能

## 📅 Course Scheduling | 课程安排

* Weekly schedule view
* Multi-week schedule viewing
* Organize courses by school and day
* Manage course time, classroom, group, and student number
* Configure course start and end dates
* Support multiple teachers per course
* Make weekly teacher changes without modifying the regular course configuration

---

## 👨‍🏫 Teacher Management | 教师管理

* Add and manage teachers
* Configure teacher working days
* Record teacher leave
* Assign teachers to courses
* Support up to four teachers per course
* View an individual teacher's schedule across multiple weeks

---

## 🔄 Weekly Teacher Assignments | 每周教师分配

EduScheduler separates the **regular course schedule** from the **actual teacher assignment for a specific week**.

```text
Regular Course
      │
      ▼
Previous Assignment
      │
      ▼
Current Week Assignment
      │
      └── Override when necessary
```

This allows a regular course to remain unchanged while teachers can be temporarily reassigned for a particular week.

**中文**

系统将长期课程设置和某一周实际的教师安排分开管理。

例如：

```text
Regular Course
Monday 16:00–17:00
School A Robotics

Week 1 → Teacher A + Teacher B
Week 2 → Teacher A + Teacher C
Week 3 → Teacher B + Teacher C
```

这样临时调课不会破坏课程本身的长期配置。

当某一周没有新的教师分配时，系统可以根据之前的有效安排进行继承，从而减少重复录入。

---

## ⚠️ Conflict Detection | 冲突检测

The system checks for potential issues such as:

* Teacher time conflicts
* Teachers assigned during their leave
* Teachers scheduled at different schools at overlapping times

Conflicts are displayed as **warnings**, rather than hard restrictions.

**中文**

系统会检查：

* 教师课程时间冲突
* 教师请假期间的课程安排
* 教师在不同学校之间的时间重叠

系统不会直接禁止操作，而是提醒排课人员进行人工确认。

---

## 🗓️ School-Specific Calendar | 学校独立日历

Each school has its own calendar.

```text
School A → Holiday
School B → Classes
School C → Holiday
```

A holiday at one school does not automatically affect other schools.

**中文**

每个学校拥有独立的不上课日期。

因此：

> **School A 放假 ≠ 所有学校都放假**

课程本身的 **start date / end date** 决定课程实际存在的时间范围，而临时假期、取消课程等情况则通过 **schedule exceptions** 单独管理。

---

## 🏫 School Management | 学校管理

* Add and edit schools
* Assign visual colors to schools
* Manage school-specific holidays
* Group courses by school

---

## 📱 Multi-Week Schedule View | 多周课表

The **Teachers Schedule** page supports viewing schedules across multiple weeks.

Instead of being limited to a single week, users can select a longer date range to review a teacher's schedule.

This is particularly useful for teachers who:

* Work part-time
* Teach at multiple schools
* Have different assignments in different weeks
* Need to check upcoming classes over a longer period

**中文**

Teachers Schedule 页面支持**多周课表查看**。

用户可以选择一个时间范围，查看教师在这段时间内的课程，而不需要一周一周地切换。

这对于兼职教师尤其方便，可以快速了解未来一段时间需要在哪些学校、什么时间上课。

---

## 🖨️ Print View | 打印视图

EduScheduler provides a dedicated **Print View** for teacher schedules.

Instead of displaying every individual class date, the print view presents a more compact overview of a teacher's regular courses.

It includes information such as:

* Day of the week
* Time
* School
* Course
* Classroom
* Course period
* Schedule exceptions / no-class dates

The view is designed to be printed or saved as a PDF directly from the browser.

**中文**

系统提供了专门的 **Print View**。

相比完整的日历课表，Print View 会将教师的常规课程进行压缩整理，更适合需要快速查看课程安排的兼职教师。

例如：

```text
Monday
15:30–16:30
ISB
Python AI
Room 302

Course period: Sep 14 – Nov 13
No class: Oct 1–8 — National Day Holiday
```

这样兼职教师可以更方便地查看自己的长期课程安排，并直接通过浏览器打印或保存为 PDF。

---

# 🧩 Design Philosophy | 设计理念

## Human-in-the-loop Scheduling

**中文**

EduScheduler 并不试图完全自动化排课。

复杂的教育排课工作往往包含一些软件无法直接判断的现实因素，例如：

* 教师在不同学校之间移动
* 临时人员调整
* 特殊课程安排
* 教室和学生数量
* 某些看似冲突、但实际上经过人工确认是可行的安排

因此，系统负责：

**Detect → Warn → Visualize**

而最终的：

**Review → Decide → Adjust**

仍然交给排课人员。

**English**

EduScheduler does not attempt to completely automate the scheduling process.

Real-world education scheduling can involve factors that are difficult for software to determine automatically, such as:

* Teacher movement between schools
* Temporary staff changes
* Special course arrangements
* Classroom and student capacity
* Apparent conflicts that have been manually verified as workable

The system focuses on:

**Detect → Warn → Visualize**

while leaving:

**Review → Decide → Adjust**

to the scheduling staff.

---

# 🛠️ Tech Stack | 技术栈

The current version uses a lightweight serverless architecture built around Cloudflare.

### Backend

* TypeScript
* Cloudflare Workers

### Database

* Cloudflare D1
* SQLite

### Frontend

* HTML
* CSS
* JavaScript

### Deployment

* Cloudflare Workers
* Cloudflare D1

---

# ☁️ Why Cloudflare Workers + D1?

The original version of EduScheduler was built with **Python / FastAPI + MySQL**.

It worked well as a local or traditional server-based application, but maintaining a separate backend server and database added unnecessary infrastructure for a relatively lightweight scheduling system.

As the project developed, I wanted a simpler way to deploy and access the application remotely.

The project was therefore migrated to:

```text
Python / FastAPI + MySQL
              │
              ▼
TypeScript + Cloudflare Workers + D1
```

### Why this architecture?

* **Cloudflare Workers** provides serverless application hosting without maintaining a traditional server.
* **Cloudflare D1** provides a lightweight SQLite-based database integrated with the Cloudflare platform.
* **TypeScript** allows the application to run as a lightweight Worker-based service.
* Deployment and updates can be handled directly through Cloudflare.
* The application can be accessed remotely without maintaining a dedicated backend server.

The goal of the migration was not simply to change the programming language, but to simplify the overall deployment and maintenance model.

---

# 📁 Project Structure | 项目结构

The current project is organized as a Cloudflare Worker application.

```text
eduSchedulerTS/
│
├── src/
│   └── index.ts
│
├── migrations/
│   └── ...
│
├── wrangler.toml
├── package.json
├── package-lock.json
└── README.md
```

The main application logic is currently contained in:

```text
src/index.ts
```

The database schema and changes are managed through D1 migrations.

---

# 🚀 Getting Started | 安装与运行

## Requirements | 环境要求

You will need:

* Node.js
* npm
* Cloudflare Wrangler
* A Cloudflare account for remote deployment

---

## 1. Clone the repository | 克隆项目

```bash
git clone https://github.com/Zoe799/eduSchedulerTS.git
cd eduSchedulerTS
```

---

## 2. Install dependencies | 安装依赖

```bash
npm install
```

---

## 3. Run locally | 本地运行

Start the Cloudflare Worker locally:

```bash
npx wrangler dev
```

Wrangler will provide a local development URL.

---

# 🗄️ Database | 数据库

The current version uses **Cloudflare D1**, a serverless SQL database based on SQLite.

The Worker accesses the database through the D1 binding:

```text
edu_scheduler_db
```

The database stores information related to:

* Schools
* Courses
* Teachers
* Teacher working days
* Teacher leave
* Weekly teacher assignments
* Schedule exceptions

Database changes are managed using migration files.

---

## D1 Migrations

Apply migrations locally or remotely using Wrangler.

For example:

```bash
npx wrangler d1 migrations apply edu_scheduler_db
```

For production deployment, make sure the correct Cloudflare D1 database is being targeted before applying migrations.

---

# 🌐 Deployment | 部署

The application can be deployed directly to Cloudflare Workers using Wrangler:

```bash
npx wrangler deploy
```

Cloudflare will deploy the Worker and provide a public URL.

A custom domain can also be connected through Cloudflare if required.

---

# 🔐 Environment & Configuration

Cloudflare-specific configuration is stored in the project's Wrangler configuration.

The D1 database is connected through the configured binding:

```text
edu_scheduler_db
```

Sensitive credentials and configuration should not be committed to GitHub.

---

# 📌 Current Status | 当前状态

**中文**

EduScheduler 目前主要用于课外教育机构内部的课程和教师排课管理。

当前版本已经从最初的 Python / FastAPI + MySQL 架构迁移到 TypeScript / Cloudflare Workers + D1，并继续进行功能开发。

目前已经支持：

* 多学校课程管理
* 教师管理
* 教师工作日和请假
* 每周教师分配
* 教师课程冲突提醒
* 学校独立假期
* 课程开始和结束日期
* 多周教师课表查看
* Part-time Teacher Print View

**English**

EduScheduler is currently designed for internal scheduling and teacher management in an after-school education environment.

The current version has been migrated from the original Python / FastAPI + MySQL architecture to **TypeScript / Cloudflare Workers + D1** and continues to be actively developed.

Current functionality includes:

* Multi-school course management
* Teacher management
* Teacher working days and leave
* Weekly teacher assignments
* Teacher scheduling conflict warnings
* School-specific holidays
* Course start and end dates
* Multi-week teacher schedule viewing
* Dedicated Print View for part-time teachers

---

# 🔮 Future Improvements | 后续计划

Possible future improvements include:

* 📱 Improve the mobile interface
  优化移动端界面

* 🤖 Explore automated schedule generation
  探索自动排课

* ⚠️ Improve conflict visualization
  改进冲突可视化

* 👨‍🏫 Improve teacher availability management
  完善教师可用时间管理

* 💾 Automated database backup
  自动数据库备份

* 🔐 User authentication and permissions
  用户登录与权限管理

* 📊 Schedule export and reporting
  课表导出与数据报告

* 🌐 Further improve deployment and hosting
  进一步优化部署和访问方式

---

# 🔗 Related Repository | 相关版本

### Original Python Version

The original implementation was developed using:

* Python
* FastAPI
* MySQL
* Jinja2

It contains the earlier implementation and more extensive historical documentation.

**[EduScheduler – Python / FastAPI + MySQL](https://github.com/Zoe799/EduScheduler)**

### Current TypeScript Version

This repository is the current implementation:

**[EduScheduler – TypeScript / Cloudflare Workers + D1](https://github.com/Zoe799/eduSchedulerTS)**

---

# 🔒 License

This project is currently intended for internal use.

本项目目前主要用于内部使用。
