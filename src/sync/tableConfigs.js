// Table metadata for sync, in FK dependency order

/**
 * Table configurations for sync
 * Order matters: tables are synced in this order to satisfy FK constraints
 */
export const SYNC_TABLES = [
  {
    name: 'User',
    timestampCol: 'updatedAt',
    columns: ['id', 'createdAt', 'updatedAt', 'email', 'lastLogin', 'lastActive', 'deletedAt'],
    primaryKey: 'id',
    hasSoftDelete: true,
    // Only sync users referenced in hangout tables
    sourceFilter: `"id" IN (
      SELECT DISTINCT "userId" FROM "UserHangoutGroup" WHERE "userId" IS NOT NULL
      UNION
      SELECT DISTINCT "userId" FROM "UserHangoutGroupAttendance" WHERE "userId" IS NOT NULL
    )`,
  },
  {
    name: 'Image',
    timestampCol: 'createdAt',
    columns: ['id', 'createdAt', 'url', 'height', 'provider', 'publicId', 'width'],
    primaryKey: 'id',
    hasSoftDelete: false,
    fkColumns: [],
  },
  {
    name: 'Order',
    timestampCol: 'updatedAt',
    columns: ['id', 'createdAt', 'updatedAt', 'userId', 'amount', 'status', 'publicId', 'type', 'expiredAt', 'uniqueCode', 'adminFee'],
    primaryKey: 'id',
    hasSoftDelete: false,
    fkColumns: [],
    // Only sync orders referenced in UserHangoutGroup
    sourceFilter: `"id" IN (SELECT DISTINCT "orderId" FROM "UserHangoutGroup" WHERE "orderId" IS NOT NULL)`,
  },
  {
    name: 'Hangout',
    timestampCol: 'updatedAt',
    columns: [
      'id',
      'createdAt',
      'updatedAt',
      'name',
      'description',
      'type',
      'price',
      'circleProfileId',
      'visibility',
      'hangoutProgramId',
      'pictureId',
    ],
    primaryKey: 'id',
    hasSoftDelete: false,
    fkColumns: ['circleProfileId', 'hangoutProgramId', 'pictureId'],
  },
  {
    name: 'HangoutEpisode',
    timestampCol: 'updatedAt',
    columns: ['id', 'createdAt', 'updatedAt', 'name', 'description', 'hangoutId', 'order'],
    primaryKey: 'id',
    hasSoftDelete: false,
    fkColumns: [],
  },
  {
    name: 'HangoutGroup',
    timestampCol: 'updatedAt',
    columns: [
      'id',
      'createdAt',
      'updatedAt',
      'name',
      'description',
      'status',
      'day',
      'time',
      'hangoutId',
      'imageId',
      'endDate',
      'startDate',
      'city',
      'province',
    ],
    primaryKey: 'id',
    hasSoftDelete: false,
    fkColumns: ['imageId'],
  },
  {
    name: 'UserHangoutGroup',
    timestampCol: 'updatedAt',
    columns: [
      'id',
      'createdAt',
      'updatedAt',
      'joinedAt',
      'status',
      'hangoutGroupRole',
      'hangoutGroupId',
      'userId',
      'publicId',
      'userEmail',
      'orderId',
    ],
    primaryKey: 'id',
    hasSoftDelete: false,
    fkColumns: ['orderId'],
  },
  {
    name: 'UserHangoutGroupAttendance',
    timestampCol: 'attendedAt',
    columns: ['id', 'attendedAt', 'hangoutEpisodeId', 'hangoutGroupId', 'userId'],
    primaryKey: 'id',
    hasSoftDelete: false,
    fkColumns: [],
  },
];

/**
 * FK column to referenced table mapping
 */
export const FK_TABLE_MAP = {
  circleProfileId: 'CircleProfile',
  hangoutProgramId: 'HangoutProgram',
  pictureId: 'Image',
  imageId: 'Image',
  orderId: 'Order',
};
