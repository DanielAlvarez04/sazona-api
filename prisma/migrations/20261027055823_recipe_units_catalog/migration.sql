-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UnitCode" ADD VALUE 'MG';
ALTER TYPE "UnitCode" ADD VALUE 'OZ';
ALTER TYPE "UnitCode" ADD VALUE 'LB';
ALTER TYPE "UnitCode" ADD VALUE 'TSP';
ALTER TYPE "UnitCode" ADD VALUE 'TBSP';
ALTER TYPE "UnitCode" ADD VALUE 'CUP';
ALTER TYPE "UnitCode" ADD VALUE 'FL_OZ';
ALTER TYPE "UnitCode" ADD VALUE 'GAL';
ALTER TYPE "UnitCode" ADD VALUE 'HALF_PIECE';
ALTER TYPE "UnitCode" ADD VALUE 'PAIR';
ALTER TYPE "UnitCode" ADD VALUE 'HALF_DOZEN';
ALTER TYPE "UnitCode" ADD VALUE 'DOZEN';
