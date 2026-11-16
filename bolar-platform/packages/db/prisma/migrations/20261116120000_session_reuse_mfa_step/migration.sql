-- Review findings 9 and 13: refresh-token reuse detection and TOTP replay guard.
ALTER TABLE "Session" ADD COLUMN "prevRefreshTokenHash" TEXT;
CREATE INDEX "Session_prevRefreshTokenHash_idx" ON "Session"("prevRefreshTokenHash");
ALTER TABLE "UserProfile" ADD COLUMN "mfaLastUsedStep" INTEGER;
