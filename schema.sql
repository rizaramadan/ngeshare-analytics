-- Schema for ngeShare Analytics Local Database
-- This schema mirrors the production database structure

-- Table: User
CREATE TABLE IF NOT EXISTS public."User" (
    id TEXT PRIMARY KEY NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    email TEXT,
    "lastLogin" TIMESTAMP(3),
    "lastActive" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3)
);

-- Table: CircleProfile (referenced by Hangout)
-- Note: This is a placeholder for FK constraint. May need expansion based on actual production schema
CREATE TABLE IF NOT EXISTS public."CircleProfile" (
    id TEXT PRIMARY KEY NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Table: Image (referenced by Hangout and HangoutGroup)
-- Note: This is a placeholder for FK constraint. May need expansion based on actual production schema
CREATE TABLE IF NOT EXISTS public."Image" (
    id TEXT PRIMARY KEY NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Table: HangoutProgram (referenced by Hangout)
-- Note: This is a placeholder for FK constraint. May need expansion based on actual production schema
CREATE TABLE IF NOT EXISTS public."HangoutProgram" (
    id TEXT PRIMARY KEY NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Table: Order (referenced by UserHangoutGroup)
-- Note: This is a placeholder for FK constraint. May need expansion based on actual production schema
CREATE TABLE IF NOT EXISTS public."Order" (
    id TEXT PRIMARY KEY NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Table: Hangout
CREATE TABLE IF NOT EXISTS public."Hangout" (
    id TEXT PRIMARY KEY NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    "circleProfileId" TEXT NOT NULL REFERENCES public."CircleProfile"
        ON UPDATE CASCADE ON DELETE RESTRICT,
    visibility TEXT DEFAULT 'PUBLIC'::TEXT NOT NULL,
    "hangoutProgramId" TEXT REFERENCES public."HangoutProgram"
        ON UPDATE CASCADE ON DELETE SET NULL,
    "pictureId" TEXT REFERENCES public."Image"
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- Table: HangoutEpisode
CREATE TABLE IF NOT EXISTS public."HangoutEpisode" (
    id TEXT PRIMARY KEY NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    "hangoutId" TEXT NOT NULL REFERENCES public."Hangout"
        ON UPDATE CASCADE ON DELETE RESTRICT,
    "order" INTEGER DEFAULT 1 NOT NULL
);

-- Table: HangoutGroup
CREATE TABLE IF NOT EXISTS public."HangoutGroup" (
    id TEXT PRIMARY KEY NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    day INTEGER,
    time TIMESTAMP(3),
    "hangoutId" TEXT REFERENCES public."Hangout"
        ON UPDATE CASCADE ON DELETE SET NULL,
    "imageId" TEXT REFERENCES public."Image"
        ON UPDATE CASCADE ON DELETE SET NULL,
    "endDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    city TEXT,
    province TEXT
);

-- Table: UserHangoutGroup
CREATE TABLE IF NOT EXISTS public."UserHangoutGroup" (
    id TEXT PRIMARY KEY NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "joinedAt" TIMESTAMP(3),
    status TEXT NOT NULL,
    "hangoutGroupRole" TEXT NOT NULL,
    "hangoutGroupId" TEXT NOT NULL REFERENCES public."HangoutGroup"
        ON UPDATE CASCADE ON DELETE RESTRICT,
    "userId" TEXT REFERENCES public."User"
        ON UPDATE CASCADE ON DELETE SET NULL,
    "publicId" TEXT,
    "userEmail" TEXT,
    "orderId" TEXT REFERENCES public."Order"
        ON UPDATE CASCADE ON DELETE SET NULL
);

-- Table: UserHangoutGroupAttendance
CREATE TABLE IF NOT EXISTS public."UserHangoutGroupAttendance" (
    id TEXT PRIMARY KEY NOT NULL,
    "attendedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "hangoutEpisodeId" TEXT NOT NULL REFERENCES public."HangoutEpisode"
        ON UPDATE CASCADE ON DELETE RESTRICT,
    "hangoutGroupId" TEXT NOT NULL REFERENCES public."HangoutGroup"
        ON UPDATE CASCADE ON DELETE RESTRICT,
    "userId" TEXT NOT NULL REFERENCES public."User"
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- Table: sync_log (for audit trail)
CREATE TABLE IF NOT EXISTS public.sync_log (
    id SERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    sync_started_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    sync_completed_at TIMESTAMP(3),
    rows_synced INTEGER,
    status TEXT NOT NULL, -- 'in_progress', 'completed', 'failed'
    error_message TEXT,
    last_sync_timestamp TIMESTAMP(3) -- The timestamp used for incremental sync
);

-- Create indexes for common query patterns (Phase 2.5 indexes)
CREATE INDEX IF NOT EXISTS idx_user_hangout_group_group_role
    ON public."UserHangoutGroup"("hangoutGroupId", "hangoutGroupRole");

CREATE INDEX IF NOT EXISTS idx_user_hangout_group_user_joined
    ON public."UserHangoutGroup"("userId", "joinedAt");

CREATE INDEX IF NOT EXISTS idx_attendance_group_attended
    ON public."UserHangoutGroupAttendance"("hangoutGroupId", "attendedAt");

-- Comments for documentation
COMMENT ON TABLE public.sync_log IS 'Audit trail for all sync operations';
COMMENT ON COLUMN public.sync_log.last_sync_timestamp IS 'The timestamp used to filter records during incremental sync';
