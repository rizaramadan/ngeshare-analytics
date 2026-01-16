# Project: ngeShare Local Analytics & Sync Tool (Revised)

## 0. Pre-Requisites & Clarifications
*Resolve these BEFORE implementation begins.*

### Technology Stack
| Component | Technology |
|-----------|------------|
| **Sync Script** | NodeJS |
| **Local Database** | PostgreSQL 15+ (Docker) |
| **Web Framework** | NodeJS/NestJs |
| **Frontend** | HTML + Vanilla JS + CSS |

### A. Schema Documentation
```sql
create table public."User"
(
    id           text                                   not null
        primary key,
    "createdAt"  timestamp(3) default CURRENT_TIMESTAMP not null,
    "updatedAt"  timestamp(3)                           not null,
    email        text,
    "lastLogin"  timestamp(3),
    "lastActive" timestamp(3),
    "deletedAt"  timestamp(3)
);

create table public."Hangout"
(
    id                 text                                   not null
        primary key,
    "createdAt"        timestamp(3) default CURRENT_TIMESTAMP not null,
    "updatedAt"        timestamp(3)                           not null,
    name               text                                   not null,
    description        text,
    type               text                                   not null,
    price              double precision                       not null,
    "circleProfileId"  text                                   not null
        references public."CircleProfile"
            on update cascade on delete restrict,
    visibility         text         default 'PUBLIC'::text    not null,
    "hangoutProgramId" text
                                                              references public."HangoutProgram"
                                                                  on update cascade on delete set null,
    "pictureId"        text
                                                              references public."Image"
                                                                  on update cascade on delete set null
);
   



create table public."HangoutEpisode"
(
    id          text                                   not null
        primary key,
    "createdAt" timestamp(3) default CURRENT_TIMESTAMP not null,
    "updatedAt" timestamp(3)                           not null,
    name        text                                   not null,
    description text,
    "hangoutId" text                                   not null
        references public."Hangout"
            on update cascade on delete restrict,
    "order"     integer      default 1                 not null
);



create table public."HangoutGroup"
(
    id          text                                   not null
        primary key,
    "createdAt" timestamp(3) default CURRENT_TIMESTAMP not null,
    "updatedAt" timestamp(3)                           not null,
    name        text                                   not null,
    description text,
    status      text                                   not null,
    day         integer,
    time        timestamp(3),
    "hangoutId" text
                                                       references public."Hangout"
                                                           on update cascade on delete set null,
    "imageId"   text
                                                       references public."Image"
                                                           on update cascade on delete set null,
    "endDate"   timestamp(3),
    "startDate" timestamp(3),
    city        text,
    province    text
);


create table public."UserHangoutGroup"
(
    id                 text                                   not null
        primary key,
    "createdAt"        timestamp(3) default CURRENT_TIMESTAMP not null,
    "updatedAt"        timestamp(3)                           not null,
    "joinedAt"         timestamp(3),
    status             text                                   not null,
    "hangoutGroupRole" text                                   not null,
    "hangoutGroupId"   text                                   not null
        references public."HangoutGroup"
            on update cascade on delete restrict,
    "userId"           text
                                                              references public."User"
                                                                  on update cascade on delete set null,
    "publicId"         text,
    "userEmail"        text,
    "orderId"          text
                                                              references public."Order"
                                                                  on update cascade on delete set null
);



create table public."UserHangoutGroupAttendance"
(
    id                 text                                   not null
        primary key,
    "attendedAt"       timestamp(3) default CURRENT_TIMESTAMP not null,
    "hangoutEpisodeId" text                                   not null
        references public."HangoutEpisode"
            on update cascade on delete restrict,
    "hangoutGroupId"   text                                   not null
        references public."HangoutGroup"
            on update cascade on delete restrict,
    "userId"           text                                   not null
        references public."User"
            on update cascade on delete restrict
);


```

### B. Business Logic Clarifications
| Question | Answer |
|----------|--------|
| **Same Group time window**: Max gap between Course A graduation → Course B start? | 3 months |
| Can members be in multiple active groups simultaneously? | yes |
| Is curriculum sequence (Aqidah→Hijrah→Sejarah→Dakwah) strictly enforced? | yes |
| How to handle groups that skip courses in the funnel? | mark it as anomaly |
| What if `joinedAt` is NULL for legacy `UserHangoutGroup` records? | ignore the record |

### C. Operational Requirements
| Question | Answer |
|----------|--------|
| Output format: Dashboard / CSV / Ad-hoc SQL? | webapp |
| Required data freshness: Real-time / Daily / Weekly? | a button for manual sync |
| Expected data volume per table? | tens of thousands |
| Any PII/privacy concerns with local storage? | no |

**Success Criteria:** All questions in tables B and C are answered and documented.

---

## 1. Domain "Truths" & Business Logic
*These rules must be applied strictly in all SQL logic.*

### A. The Curriculum (Max Episodes)
| Course | Max Episodes |
|--------|-------------|
| `'Ngeshare Sesi Aqidah'` | **9** |
| `'Ngeshare Sesi Hijrah'` | **9** |
| `'Ngeshare Sesi Sejarah'` | **11** |
| `'Ngeshare Sesi Dakwah'` | **7** |

### B. Group Status Logic
| Status | Condition |
|--------|-----------|
| **ACTIVE** | Attendance recorded in last **28 days** |
| **GRADUATED** | Latest attended episode = Max Episode for course |
| **STALLED** | No attendance >28 days AND latest episode < Max Episode |

### C. Pipeline Continuity ("Same Group" Linking)
A group moving from Course A → Course B is the "same group" if:
1. `Facilitator` is the same
2. **≥2 Members** overlap in `UserHangoutGroup` membership
3. Time gap between graduation and new start ≤ **90 days** (3 months)

### D. Alumni Rule
A Facilitator is `is_alumni = TRUE` if they have a historical `UserHangoutGroup` record as `'MEMBER'` with `joinedAt` earlier than their current `'FACILITATOR'` record.

---

## 2. Implementation Plan

### Phase 1: Infrastructure & Syncing

#### 1.1 Local DB Setup
- [ ] **1.1.1** Create `docker-compose.yml` with Postgres 15+ container
- [ ] **1.1.2** Configure volume persistence for data durability
- [ ] **1.1.3** Create `schema.sql` with production DDL
- [ ] **1.1.4** Run schema migration on local DB
- [ ] **1.1.5** Create `sync_log` table for audit trail

**Success Criteria:** Local DB running, schema matches production structure.

#### 1.2 Base Sync Script

**Sync Order (FK dependencies):** `User` → `Hangout` → `HangoutEpisode` → `HangoutGroup` → `UserHangoutGroup` → `Attendance`

- [ ] **1.2.1** Create DB connection utility with retry logic (Source + Dest)
- [ ] **1.2.2** Implement `getLastSyncTimestamp(tableName)` function
- [ ] **1.2.3** Implement generic `syncTable(tableName, timestampCol)` function
- [ ] **1.2.4** Sync `User` table (required for attendance FK)
- [ ] **1.2.5** Sync `Hangout` table — verify row count
- [ ] **1.2.6** Sync `HangoutEpisode` table — verify row count
- [ ] **1.2.7** Sync `HangoutGroup` table — verify row count
- [ ] **1.2.8** Sync `UserHangoutGroup` table — verify row count
- [ ] **1.2.9** Handle `deletedAt` sync — propagate soft deletes to local DB
- [ ] **1.2.10** Ensure idempotent sync (re-running should not duplicate data)
- [ ] **1.2.11** Wrap each table sync in transaction

**Success Criteria:** All incremental tables sync correctly; row counts match ±0.1%; soft deletes propagated.

#### 1.3 Attendance Sync ("Window Sync")

> **Note:** This window sync means historical attendance beyond 45 days will not be in local DB. Graduation status for groups that completed >45 days ago must rely on cached/computed status, not raw attendance recalculation.

- [ ] **1.3.1** Implement DELETE for local records where `attendedAt > NOW() - 45 days`
- [ ] **1.3.2** Implement INSERT from production where `attendedAt > NOW() - 45 days`
- [ ] **1.3.3** Add batch processing if >10k rows (chunk size: 5000)
- [ ] **1.3.4** Log sync duration and row counts
- [ ] **1.3.5** Backup local attendance data before destructive sync

**Success Criteria:** Attendance data for last 45 days matches production exactly.

#### 1.4 Sync Validation & Quality
- [ ] **1.4.1** Create validation query: compare row counts source vs dest
- [ ] **1.4.2** Create data quality report: NULL counts, orphan FKs, date anomalies
- [ ] **1.4.3** Document any known data issues

**Success Criteria:** Validation passes; data quality issues documented.

#### 1.5 Error Handling
- [ ] **1.5.1** Define retry strategy for connection failures (3 retries, exponential backoff)
- [ ] **1.5.2** Implement partial sync recovery (resume from last successful batch)
- [ ] **1.5.3** Create `sync_error_log` table with timestamps and error details
- [ ] **1.5.4** Alert/log when sync fails after all retries

**Success Criteria:** Sync gracefully handles temporary failures; errors logged for debugging.

---

### Phase 2: Data Cleaning & Base Views

#### 2.1 View: `v_group_summary`
```sql
-- Columns: group_id, group_name, course_name, max_episodes, facilitator_id, facilitator_name, member_count, created_at
```
- [ ] **2.1.0** Decide view strategy: Regular views vs Materialized views with manual refresh
- [ ] **2.1.1** JOIN `HangoutGroup` → `Hangout` (for course name)
- [ ] **2.1.2** JOIN `UserHangoutGroup` WHERE role = 'FACILITATOR'
- [ ] **2.1.3** Handle edge cases:
  - Groups with 0 facilitators → Flag as `needs_facilitator = TRUE`
  - Groups with >1 facilitators → Use earliest `joinedAt` or log as anomaly
- [ ] **2.1.4** Add `max_episodes` lookup based on course name

**Success Criteria:** All groups have exactly 1 facilitator row; edge cases handled gracefully; no NULLs in required columns.

#### 2.2 View: `v_group_progress`
```sql
-- Columns: group_id, max_episode_reached, last_meeting_date, total_meetings, days_since_last_meeting
```
- [ ] **2.2.1** Aggregate `UserHangoutGroupAttendance` by group
- [ ] **2.2.2** Calculate `max_episode_reached` using `HangoutEpisode.order` field (not count)
- [ ] **2.2.3** Calculate `last_meeting_date` (MAX of attendedAt)
- [ ] **2.2.4** Calculate `days_since_last_meeting` (CURRENT_DATE - last_meeting_date)

**Success Criteria:** View executes in <2 seconds; all active groups have progress data.

#### 2.3 View: `v_member_roster`
```sql
-- Columns: group_id, user_id, user_name, role, joined_at, is_active
```
- [ ] **2.3.1** List all members per group from `UserHangoutGroup`
- [ ] **2.3.2** Include role (FACILITATOR/MEMBER)
- [ ] **2.3.3** Calculate `is_active` based on recent attendance

**Success Criteria:** Every group has at least 1 facilitator and 2-5 members.

#### 2.4 Reference Data
- [ ] **2.4.1** Create `course_config` table:
  ```sql
  CREATE TABLE course_config (
    course_name TEXT PRIMARY KEY,
    max_episodes INTEGER NOT NULL,
    sequence_order INTEGER NOT NULL  -- 1=Aqidah, 2=Hijrah, 3=Sejarah, 4=Dakwah
  );
  ```
- [ ] **2.4.2** Populate with curriculum data (avoids hardcoding in views)

**Success Criteria:** All views reference `course_config` instead of hardcoded values.

#### 2.5 Performance Optimization
- [ ] **2.5.1** Add index on `UserHangoutGroupAttendance(hangoutGroupId, attendedAt)`
- [ ] **2.5.2** Add index on `UserHangoutGroup(hangoutGroupId, hangoutGroupRole)`
- [ ] **2.5.3** Add index on `UserHangoutGroup(userId, joinedAt)`
- [ ] **2.5.4** Benchmark view execution times; target <2 seconds

**Success Criteria:** All views execute in <2 seconds on full dataset.

---

### Phase 3: Advanced Business Logic

#### 3.1 View: `v_group_status` (Health Check)
```sql
-- Columns: group_id, course_name, status ('ACTIVE'/'GRADUATED'/'STALLED'), progress_pct, days_inactive
```
- [ ] **3.1.1** JOIN `v_group_summary` + `v_group_progress`
- [ ] **3.1.2** Apply status logic (B) with CASE statement
- [ ] **3.1.3** Calculate `progress_pct` = max_episode_reached / max_episodes * 100
- [ ] **3.1.4** Validate: manually spot-check 10 groups of each status

**Depends on:** 2.1, 2.2  
**Success Criteria:** Status distribution matches manual verification (±5%).

#### 3.2 View: `v_facilitator_alumni`
```sql
-- Columns: facilitator_id, facilitator_name, is_alumni, member_since, facilitator_since
```
- [ ] **3.2.1** Find all users with role = 'FACILITATOR'
- [ ] **3.2.2** Check if same user has historical role = 'MEMBER' with earlier date
- [ ] **3.2.3** Handle NULL `joinedAt` gracefully (COALESCE to createdAt or exclude)

**Success Criteria:** Alumni flag correctly identifies facilitators with member history.

#### 3.3 View: `v_curriculum_pipeline` (Group Linker)
```sql
-- Columns: group_a_id, course_a, group_b_id, course_b, shared_facilitator_id, shared_member_count, overlap_pct, days_between
```
- [ ] **3.3.1** Self-join `HangoutGroup` on same facilitator
- [ ] **3.3.2** Filter: course_b follows course_a in sequence (use `course_config.sequence_order`)
- [ ] **3.3.3** Count overlapping members using `UserHangoutGroup`
- [ ] **3.3.4** Calculate `overlap_pct` = shared_member_count / MIN(group_a_size, group_b_size) * 100
- [ ] **3.3.5** Filter: shared_member_count ≥ 2 AND overlap_pct ≥ 50%
- [ ] **3.3.6** Calculate `days_between` (course_b start - course_a graduation)

**Depends on:** 2.1, 2.3  
**Success Criteria:** Pipeline correctly links groups across curriculum stages.

#### 3.4 View: `v_member_journey`
```sql
-- Columns: user_id, user_name, groups_joined, courses_completed, current_course, is_facilitator_now
```
- [ ] **3.4.1** Track individual members across all their group memberships
- [ ] **3.4.2** Count courses completed (as member)
- [ ] **3.4.3** Identify if member has become facilitator (alumni path)

**Success Criteria:** Can trace any member's full journey through curriculum.

---

### Phase 4: Final Reporting & Metrics

#### 4.1 Metric: Facilitator Growth
- [ ] **4.1.1** Total Facilitators (all time)
- [ ] **4.1.2** Active Facilitators (with ACTIVE group in last 28 days)
- [ ] **4.1.3** % Alumni (is_alumni = TRUE)
- [ ] **4.1.4** New Facilitators per month (trend)

**Depends on:** 3.1, 3.2

#### 4.2 Metric: The Curriculum Funnel
- [ ] **4.2.1** Groups started per course (Aqidah, Hijrah, Sejarah, Dakwah)
- [ ] **4.2.2** Graduation rate per course (GRADUATED / Total)
- [ ] **4.2.3** Continuation rate: % that started next course
- [ ] **4.2.4** Drop-off analysis: at which episode do most groups STALL?

**Depends on:** 3.1, 3.3

#### 4.3 Feature: The "Rescue List"
- [ ] **4.3.1** Filter groups: status = 'STALLED' AND progress_pct ≥ 70%
- [ ] **4.3.2** Include: facilitator contact, last meeting date, episodes remaining
- [ ] **4.3.3** Sort by: days_inactive ASC (most recent first = easier rescue)

**Depends on:** 3.1

#### 4.4 Metric: Time-to-Graduate
- [ ] **4.4.1** Calculate avg days from first meeting to graduation per course
- [ ] **4.4.2** Identify outliers (unusually fast or slow)

---

### Phase 5: Web Application

#### 5.1 Dashboard Infrastructure
- [ ] **5.1.1** Set up web framework (Go/Echo or Python/Flask)
- [ ] **5.1.2** Create base layout with navigation
- [ ] **5.1.3** Implement "Sync Now" button with progress indicator
- [ ] **5.1.4** Display last sync timestamp and status
- [ ] **5.1.5** Add basic authentication (optional, for local use)

**Success Criteria:** Web app accessible on localhost:8080; sync button triggers full sync.

#### 5.2 Dashboard Views
- [ ] **5.2.1** Homepage with key metrics summary (cards)
- [ ] **5.2.2** Facilitator Growth dashboard with trend chart
- [ ] **5.2.3** Curriculum Funnel visualization (bar chart or Sankey diagram)
- [ ] **5.2.4** Rescue List page with sortable table
- [ ] **5.2.5** Export to CSV functionality for all tables

**Depends on:** 4.1, 4.2, 4.3, 4.4  
**Success Criteria:** All metrics displayed correctly; CSV export works; UI is responsive.


## 3. Dependency Graph

```
Phase 1 (Serial):
  1.1 → 1.2 → 1.3 → 1.4 → 1.5

Phase 2 (Parallel after 1.5):
  1.5 → 2.1
  1.5 → 2.2
  1.5 → 2.3
  1.5 → 2.4 (course_config table)
  2.1 + 2.2 + 2.3 + 2.4 → 2.5

Phase 3 (Dependencies):
  2.5 + 2.1 + 2.2 → 3.1
  2.1 → 3.2
  2.1 + 2.3 + 2.4 → 3.3
  2.3 → 3.4

Phase 4 (Dependencies):
  3.1 + 3.2 → 4.1
  3.1 + 3.3 → 4.2
  3.1 → 4.3
  3.1 → 4.4

Phase 5 (Dependencies):
  4.1 + 4.2 + 4.3 + 4.4 → 5.1
  5.1 → 5.2
```

---

## 4. Success Criteria Summary

| Phase | Criteria |
|-------|----------|
| **Phase 1** | Row counts match ±0.1%; Sync completes in <5 min; Errors logged; Soft deletes handled |
| **Phase 2** | Views execute in <2 sec; No NULL in required columns; Edge cases handled; Indexes created |
| **Phase 3** | Status distribution matches spot-check (±5%); Pipeline links verified manually |
| **Phase 4** | Metrics match stakeholder expectations; Rescue list actionable |
| **Phase 5** | Web app accessible on localhost; Sync button functional; All metrics displayed |

---

## 5. Session Log
*(Update after each work session)*

| Date | Phase | Tasks Completed | Blockers | Next Action |
|------|-------|-----------------|----------|-------------|
| _TBD_ | 0 | - | - | Resolve Pre-Requisites |
