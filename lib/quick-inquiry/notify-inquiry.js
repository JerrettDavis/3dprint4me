export function notifyInquiryUseCase({ hasDelivery, buildPayload, repository, send }) {
  return async function notifyInquiry(row) {
    if (!hasDelivery()) return { attempted: false };
    const claimed = await repository.claimNotification(row, buildPayload(row));
    if (!claimed) return { attempted: false };
    let state = "failed";
    try {
      await send(row.id, claimed);
      state = "sent";
    } catch { /* Persist only the safe outcome; provider details remain private. */ }
    await repository.finishNotification(row, state);
    return { attempted: true, state };
  };
}
