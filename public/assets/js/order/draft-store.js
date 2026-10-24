const withoutReferralChoice=value=>{const safe={...value};delete safe.referralCode;delete safe.referralConsent;delete safe.referral;return safe;};
// Customizer parameters are never stored in the browser: only which generator and version.
function withoutCustomizationParams(value) {
  if (!value?.customization) return value;
  const { generatorId, generatorVersion } = value.customization;
  return { ...value, customization: { generatorId, generatorVersion } };
}

export function createDraftStore({ storage, draftKey, submittedKey }) {
  const resolveStorage = () => typeof storage === "function" ? storage() : storage;
  return {
    loadDraft() {
      try { return withoutReferralChoice(JSON.parse(resolveStorage().getItem(draftKey) || "{}")); }
      catch { return {}; }
    },
    saveDraft(data) {
      const safe = withoutReferralChoice(withoutCustomizationParams(data));
      delete safe.terms;
      delete safe.website;
      try { resolveStorage().setItem(draftKey, JSON.stringify(safe)); return true; }
      catch { return false; }
    },
    clearDraft() {
      try { resolveStorage().removeItem(draftKey); } catch { /* Storage may be denied. */ }
    },
    saveSubmitted(request) {
      let prior = [];
      let target;
      try { target = resolveStorage(); prior = JSON.parse(target.getItem(submittedKey) || "[]"); } catch { prior = []; }
      try {
        (target ?? resolveStorage()).setItem(submittedKey, JSON.stringify([withoutCustomizationParams(request), ...prior].slice(0, 10)));
        return true;
      } catch { return false; }
    }
  };
}
