/* Valor Technical Consulting: Submit a Matter (public referral intake).
 * Posts the referral form as JSON to the Valor spine. Static site, no build step.
 * ------------------------------------------------------------------ */

/* === CONFIG: spine API base ======================================== */
/* Change this one line at cutover if the spine moves. Endpoint used:
 * `${SPINE_API}/public/referrals`. */
const SPINE_API = "https://www.valorforensics.com/api/v1";

/* === CONFIG: Cloudflare Turnstile site key ========================= */
/* Leave EMPTY until a Turnstile site key is issued. When empty, the
 * captcha widget is not rendered and cf_token is sent empty. When a key
 * is set, the widget renders into .turnstile-slot and supplies cf_token. */
const TURNSTILE_SITE_KEY = "";
/* =================================================================== */

(function () {
  "use strict";

  const form = document.getElementById("matter-form");
  if (!form) return;

  const statusEl = document.getElementById("form-status");
  const submitBtn = form.querySelector(".submit-btn");
  const loadedAtField = form.querySelector('input[name="page_loaded_at"]');

  // Stamp the load time (bot-speed guard on the spine rejects sub-3s posts).
  if (loadedAtField) loadedAtField.value = new Date().toISOString();

  // Division preselect from the referring splash (?division=engr|metr|pca-fca).
  // The client can change it; it just starts on the division they came from.
  const DIVISION_PARAM_MAP = {
    "engr": "Forensic Engineering",
    "metr": "Forensic Meteorology",
    "pca-fca": "PCA/FCA"
  };
  const divisionSelect = document.getElementById("division");
  if (divisionSelect) {
    const requested = new URLSearchParams(window.location.search).get("division");
    const mapped = requested && DIVISION_PARAM_MAP[requested.toLowerCase()];
    if (mapped) divisionSelect.value = mapped;
  }

  // Render the Turnstile widget only when a site key is configured.
  let turnstileToken = "";
  if (TURNSTILE_SITE_KEY) {
    const slot = form.querySelector(".turnstile-slot");
    if (slot) {
      window.__vtcTurnstileCb = function (token) { turnstileToken = token; };
      const widget = document.createElement("div");
      widget.className = "cf-turnstile";
      widget.setAttribute("data-sitekey", TURNSTILE_SITE_KEY);
      widget.setAttribute("data-callback", "__vtcTurnstileCb");
      slot.appendChild(widget);
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
  }

  function showStatus(state, message) {
    if (!statusEl) return;
    statusEl.setAttribute("data-state", state);
    statusEl.textContent = message;
    statusEl.hidden = false;
  }

  // Fields sent to the spine (v2 referral contract). Optional fields are
  // omitted from the payload when left blank.
  const OPTIONAL_FIELDS = [
    "phone", "company", "referral_source",
    "incident_state", "incident_city",
    "submitter_role", "other_note",
    "property_name", "property_street", "property_city",
    "property_state", "property_zip",
    "type_of_occurrence", "date_of_occurrence"
  ];

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    const fd = new FormData(form);
    const payload = {
      first_name: (fd.get("first_name") || "").trim(),
      last_name: (fd.get("last_name") || "").trim(),
      email: (fd.get("email") || "").trim(),
      description: (fd.get("description") || "").trim(),
      company_website: fd.get("company_website") || "", // honeypot, sent empty
      page_loaded_at: fd.get("page_loaded_at") || "",
      cf_token: turnstileToken
    };

    OPTIONAL_FIELDS.forEach(function (name) {
      const v = (fd.get(name) || "").trim();
      if (v) payload[name] = v;
    });

    // Division: sent as its own key (future spine contract field), and carried
    // as a labeled first line of the description so it reaches the referral
    // record under the CURRENT contract. Remove the prefix line once the spine
    // accepts `division` directly.
    const division = (fd.get("division") || "").trim();
    if (division) {
      payload.division = division;
      payload.description = "Division: " + division + "\n\n" + payload.description;
    }

    submitBtn.disabled = true;
    showStatus("pending", "Sending your matter…");

    fetch(SPINE_API + "/public/referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          form.reset();
          showStatus(
            "success",
            (result.data && result.data.message) ||
            "Check your email to confirm your submission. Your matter reaches our team the moment you do."
          );
        } else {
          submitBtn.disabled = false;
          showStatus(
            "error",
            "We couldn't submit your matter just now. Please try again in a moment, or call us at 918.970.4722."
          );
        }
      })
      .catch(function () {
        submitBtn.disabled = false;
        showStatus(
          "error",
          "We couldn't submit your matter just now. Please try again in a moment, or call us at 918.970.4722."
        );
      });
  });
})();
