-- Tile heights for the tactical (isometric) view: one whole number per cell,
-- as { cols, rows, heights }. NULL is a flat board.
ALTER TABLE "Map" ADD COLUMN "tileHeights" JSONB;
