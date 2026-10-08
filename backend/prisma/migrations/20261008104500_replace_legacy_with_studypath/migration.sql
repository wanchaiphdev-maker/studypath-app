-- StudyPath replacement migration: remove legacy business tables and align roles.
BEGIN;

CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'LECTURER', 'MEMBER');
ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new"
  USING (
    CASE
      WHEN "role"::text = 'LEADER' THEN 'LECTURER'
      ELSE "role"::text
    END
  )::"Role_new";
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'MEMBER';

ALTER TABLE "Customer" DROP CONSTRAINT "Customer_ownerId_fkey";
ALTER TABLE "Goal" DROP CONSTRAINT "Goal_userId_fkey";
ALTER TABLE "Message" DROP CONSTRAINT "Message_roomId_fkey";
ALTER TABLE "Message" DROP CONSTRAINT "Message_senderId_fkey";
ALTER TABLE "Room" DROP CONSTRAINT "Room_groupId_fkey";
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_userId_fkey";
ALTER TABLE "SaleItem" DROP CONSTRAINT "SaleItem_productId_fkey";
ALTER TABLE "SaleItem" DROP CONSTRAINT "SaleItem_saleId_fkey";
ALTER TABLE "User" DROP CONSTRAINT "User_groupId_fkey";
ALTER TABLE "User" DROP CONSTRAINT "User_uplineId_fkey";

ALTER TABLE "User" DROP COLUMN "groupId",
DROP COLUMN "rank",
DROP COLUMN "uplineId";

DROP TABLE "Contest";
DROP TABLE "Customer";
DROP TABLE "Event";
DROP TABLE "Goal";
DROP TABLE "Group";
DROP TABLE "Meeting";
DROP TABLE "Message";
DROP TABLE "News";
DROP TABLE "Notification";
DROP TABLE "Product";
DROP TABLE "Room";
DROP TABLE "Sale";
DROP TABLE "SaleItem";

DROP TYPE "RoomType";

COMMIT;
