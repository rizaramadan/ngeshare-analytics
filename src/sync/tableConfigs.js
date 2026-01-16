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
