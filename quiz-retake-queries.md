# Quiz Retake: SQL Queries

Run these queries on the **production** database. Replace the placeholders before executing.

## Placeholders

```
HANGOUT_NAME   = 'Ngeshare Sesi Aqidah'   -- e.g., 'Ngeshare Sesi Aqidah'
USER_EMAIL     = 'member@example.com'      -- member's email
EPISODE_NUMBER = 9                         -- episode number (1-based)
```

---

## Step 0: Verification (read-only)

### 0a. Find the User

```sql
SELECT id, name, email
FROM "User"
WHERE email = 'member@example.com';
```

### 0b. Find the Hangout and Episode

```sql
SELECT he.id AS episode_id, he."episodeNumber", h.id AS hangout_id, h.name AS hangout_name
FROM "HangoutEpisode" he
JOIN "Hangout" h ON h.id = he."hangoutId"
WHERE h.name = 'Ngeshare Sesi Aqidah'
  AND he."episodeNumber" = 9;
```

### 0c. Find the User's HangoutGroup

```sql
SELECT hg.id AS group_id, hg.name AS group_name, uhg.role
FROM "UserHangoutGroup" uhg
JOIN "HangoutGroup" hg ON hg.id = uhg."hangoutGroupId"
JOIN "Hangout" h ON h.id = hg."hangoutId"
WHERE uhg."userId" = (SELECT id FROM "User" WHERE email = 'member@example.com')
  AND h.name = 'Ngeshare Sesi Aqidah'
  AND uhg.role = 'MEMBER';
```

### 0d. Find the Quiz Form for this Episode

```sql
SELECT f.id AS form_id, f.title, f.type, hetf."hangoutEpisodeId"
FROM "HangoutEpisodeToForm" hetf
JOIN "Form" f ON f.id = hetf."formId"
JOIN "HangoutEpisode" he ON he.id = hetf."hangoutEpisodeId"
JOIN "Hangout" h ON h.id = he."hangoutId"
WHERE h.name = 'Ngeshare Sesi Aqidah'
  AND he."episodeNumber" = 9
  AND f.type = 'QUIZ';
```

### 0e. Find the Existing FormResponse

```sql
SELECT fr.id AS response_id, fr."formId", fr."userId", fr."createdAt"
FROM "FormResponse" fr
WHERE fr."userId" = (SELECT id FROM "User" WHERE email = 'member@example.com')
  AND fr."formId" = (
    SELECT f.id
    FROM "HangoutEpisodeToForm" hetf
    JOIN "Form" f ON f.id = hetf."formId"
    JOIN "HangoutEpisode" he ON he.id = hetf."hangoutEpisodeId"
    JOIN "Hangout" h ON h.id = he."hangoutId"
    WHERE h.name = 'Ngeshare Sesi Aqidah'
      AND he."episodeNumber" = 9
      AND f.type = 'QUIZ'
  );
```

### 0f. Check Existing Reschedule Record

```sql
SELECT hgr.id, hgr."rescheduledDate", hgr."hangoutGroupId", hgr."hangoutEpisodeId"
FROM "HangoutGroupReschedule" hgr
WHERE hgr."hangoutGroupId" = (
    SELECT hg.id
    FROM "UserHangoutGroup" uhg
    JOIN "HangoutGroup" hg ON hg.id = uhg."hangoutGroupId"
    JOIN "Hangout" h ON h.id = hg."hangoutId"
    WHERE uhg."userId" = (SELECT id FROM "User" WHERE email = 'member@example.com')
      AND h.name = 'Ngeshare Sesi Aqidah'
      AND uhg.role = 'MEMBER'
    LIMIT 1
  )
  AND hgr."hangoutEpisodeId" = (
    SELECT he.id
    FROM "HangoutEpisode" he
    JOIN "Hangout" h ON h.id = he."hangoutId"
    WHERE h.name = 'Ngeshare Sesi Aqidah'
      AND he."episodeNumber" = 9
  );
```

> **Stop here.** Confirm all IDs exist and look correct before proceeding.

---

## Step 1: Upsert Reschedule (set rescheduledDate to yesterday)

This opens the quiz by setting the reschedule date to yesterday.

```sql
INSERT INTO "HangoutGroupReschedule" ("hangoutGroupId", "hangoutEpisodeId", "rescheduledDate", "createdAt", "updatedAt")
VALUES (
  (
    SELECT hg.id
    FROM "UserHangoutGroup" uhg
    JOIN "HangoutGroup" hg ON hg.id = uhg."hangoutGroupId"
    JOIN "Hangout" h ON h.id = hg."hangoutId"
    WHERE uhg."userId" = (SELECT id FROM "User" WHERE email = 'member@example.com')
      AND h.name = 'Ngeshare Sesi Aqidah'
      AND uhg.role = 'MEMBER'
    LIMIT 1
  ),
  (
    SELECT he.id
    FROM "HangoutEpisode" he
    JOIN "Hangout" h ON h.id = he."hangoutId"
    WHERE h.name = 'Ngeshare Sesi Aqidah'
      AND he."episodeNumber" = 9
  ),
  CURRENT_DATE - INTERVAL '1 day',
  NOW(),
  NOW()
)
ON CONFLICT ("hangoutGroupId", "hangoutEpisodeId")
DO UPDATE SET
  "rescheduledDate" = CURRENT_DATE - INTERVAL '1 day',
  "updatedAt" = NOW();
```

---

## Step 2: Delete FormResponse (cascades to FormQuestionAnswer)

```sql
DELETE FROM "FormResponse"
WHERE "userId" = (SELECT id FROM "User" WHERE email = 'member@example.com')
  AND "formId" = (
    SELECT f.id
    FROM "HangoutEpisodeToForm" hetf
    JOIN "Form" f ON f.id = hetf."formId"
    JOIN "HangoutEpisode" he ON he.id = hetf."hangoutEpisodeId"
    JOIN "Hangout" h ON h.id = he."hangoutId"
    WHERE h.name = 'Ngeshare Sesi Aqidah'
      AND he."episodeNumber" = 9
      AND f.type = 'QUIZ'
  );
```

---

## Step 3: Verify Changes

### 3a. Confirm Reschedule was set

```sql
SELECT hgr.id, hgr."rescheduledDate", hgr."updatedAt"
FROM "HangoutGroupReschedule" hgr
WHERE hgr."hangoutGroupId" = (
    SELECT hg.id
    FROM "UserHangoutGroup" uhg
    JOIN "HangoutGroup" hg ON hg.id = uhg."hangoutGroupId"
    JOIN "Hangout" h ON h.id = hg."hangoutId"
    WHERE uhg."userId" = (SELECT id FROM "User" WHERE email = 'member@example.com')
      AND h.name = 'Ngeshare Sesi Aqidah'
      AND uhg.role = 'MEMBER'
    LIMIT 1
  )
  AND hgr."hangoutEpisodeId" = (
    SELECT he.id
    FROM "HangoutEpisode" he
    JOIN "Hangout" h ON h.id = he."hangoutId"
    WHERE h.name = 'Ngeshare Sesi Aqidah'
      AND he."episodeNumber" = 9
  );
```

> Expected: `rescheduledDate` = yesterday's date.

### 3b. Confirm FormResponse was deleted

```sql
SELECT COUNT(*) AS remaining_responses
FROM "FormResponse"
WHERE "userId" = (SELECT id FROM "User" WHERE email = 'member@example.com')
  AND "formId" = (
    SELECT f.id
    FROM "HangoutEpisodeToForm" hetf
    JOIN "Form" f ON f.id = hetf."formId"
    JOIN "HangoutEpisode" he ON he.id = hetf."hangoutEpisodeId"
    JOIN "Hangout" h ON h.id = he."hangoutId"
    WHERE h.name = 'Ngeshare Sesi Aqidah'
      AND he."episodeNumber" = 9
      AND f.type = 'QUIZ'
  );
```

> Expected: `0` remaining responses.
