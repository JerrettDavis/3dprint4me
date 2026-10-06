// Retention and privacy deletion for private print models. Blob objects are removed
// before their records so a failed deletion leaves a retryable row, never an orphan.
export const DEFAULT_RETENTION_POLICY = Object.freeze({ completedRetentionDays: 90, pendingUploadHours: 24 });

export function retentionPolicyFromEnv(env = process.env) {
  const days = Number(env.PRINT_ASSET_RETENTION_DAYS);
  return {
    ...DEFAULT_RETENTION_POLICY,
    completedRetentionDays: Number.isInteger(days) && days >= 1 && days <= 3650 ? days : DEFAULT_RETENTION_POLICY.completedRetentionDays
  };
}

export function createRetentionUseCases({ repository, fileStore, policy = DEFAULT_RETENTION_POLICY, now = () => new Date(), logFailure = () => {} }) {
  async function removeObject(asset, report) {
    if (asset.state === "deleted") return true;
    try {
      await fileStore.delete(asset.blobPath);
      report.deletedObjects += 1;
      return true;
    } catch {
      report.errors += 1;
      logFailure("delete");
      return false;
    }
  }

  return {
    /** One bounded maintenance pass: abandoned sessions, stale uploads, then expired completed work. */
    async sweep({ limit = 50 } = {}) {
      const report = { expiredSessions: 0, staleUploads: 0, retentionDeleted: 0, deletedObjects: 0, errors: 0, rateBucketsPruned: 0, orphanedParts: 0 };
      for (const { session, assets } of await repository.expiredSessions({ limit })) {
        let removed = true;
        for (const asset of assets) removed = (await removeObject(asset, report)) && removed;
        if (removed && await repository.deleteUnattachedSession(session.id)) report.expiredSessions += 1;
      }
      const staleBefore = new Date(now().getTime() - policy.pendingUploadHours * 3_600_000).toISOString();
      for (const asset of await repository.staleUnattachedUploads({ olderThan: staleBefore, limit })) {
        if (await removeObject(asset, report) && await repository.deleteAssetRecord(asset.id)) report.staleUploads += 1;
      }
      const completedBefore = new Date(now().getTime() - policy.completedRetentionDays * 86_400_000).toISOString();
      for (const asset of await repository.retentionCandidates({ completedBefore, limit })) {
        if (await removeObject(asset, report) && await repository.markAssetDeleted(asset.id)) report.retentionDeleted += 1;
      }
      for (const asset of await repository.orphanedParts({ limit })) {
        if (await removeObject(asset, report) && await repository.markAssetDeleted(asset.id)) report.orphanedParts += 1;
      }
      if (repository.pruneRateBuckets) {
        try { report.rateBucketsPruned = await repository.pruneRateBuckets(new Date(now().getTime() - 2 * 86_400_000).toISOString()); }
        catch { report.errors += 1; logFailure("rate-buckets"); }
      }
      return report;
    },

    /** Privacy deletion for one request: every private model object, then assets, estimates, jobs, and sessions. */
    async purgeRequest(requestId) {
      const report = { deletedObjects: 0, errors: 0, assets: 0 };
      const { assets } = await repository.forRequest(requestId);
      for (const asset of assets) {
        if (!(await removeObject(asset, report))) throw new Error("A private model object could not be deleted; no records were removed.");
      }
      const purged = await repository.purgeRequest(requestId);
      for (const asset of purged.assets.filter(candidate => !assets.some(existing => existing.id === candidate.id))) await removeObject(asset, report);
      report.assets = purged.assets.length;
      return report;
    }
  };
}
