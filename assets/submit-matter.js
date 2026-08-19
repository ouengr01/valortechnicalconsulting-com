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
    "pca-fca": "PCA/FCA",
    "rapid_consult": "Rapid Consult",
    "consult": "Rapid Consult"
  };
  const CONSULT_DIVISION = "Rapid Consult";
  const divisionSelect = document.getElementById("division");
  if (divisionSelect) {
    const requested = new URLSearchParams(window.location.search).get("division");
    const mapped = requested && DIVISION_PARAM_MAP[requested.toLowerCase()];
    if (mapped) divisionSelect.value = mapped;
  }

  /* === Rapid Consult branch =========================================
   * Division = "Rapid Consult" reveals the consult section (audience,
   * length, claim stage, involved parties, requested slot, notices, consent)
   * and turns the description box into the EMBARGOED narrative. Submit goes
   * to `${SPINE_API}/public/consult/request`, which answers with a Stripe
   * Checkout URL (card authorized now, charged only on acceptance); the
   * browser is sent there. */
  const consultSection = document.getElementById("consult-section");
  const descLabel = document.getElementById("description-label");
  const narrLabel = document.getElementById("narrative-label");
  const descField = document.getElementById("description");
  const divisionHint = document.getElementById("division-hint");
  const partiesEl = document.getElementById("parties");
  const partyTpl = document.getElementById("party-row-tpl");
  const slotSel = document.getElementById("requested_slot_id");
  const slotAltSel = document.getElementById("requested_slot_alt_id");
  const priceEl = document.getElementById("consult-price");
  const audienceSel = document.getElementById("consult_audience");
  let offer = null;
  let offerLoaded = false;

  function isConsult() {
    return divisionSelect && divisionSelect.value === CONSULT_DIVISION;
  }

  function fmtSlot(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  }

  function renderPrice() {
    if (!priceEl || !offer || !offer.price_cents) return;
    priceEl.textContent = "$" + (offer.price_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0 }) +
      " — base consult (up to " + (offer.length_min || 45) + " minutes) plus file review. Authorized now, charged only if accepted.";
  }

  function loadOffer() {
    if (offerLoaded) return;
    offerLoaded = true;
    fetch(SPINE_API + "/public/consult/offer", { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        offer = data;
        if (!slotSel) return;
        slotSel.innerHTML = "";
        slotAltSel.innerHTML = "";
        const none = document.createElement("option");
        none.value = ""; none.textContent = "Ask Valor to propose a time";
        slotSel.appendChild(none);
        const noneAlt = document.createElement("option");
        noneAlt.value = ""; noneAlt.textContent = "—";
        slotAltSel.appendChild(noneAlt);
        ((data && data.slots) || []).forEach(function (sl) {
          [slotSel, slotAltSel].forEach(function (sel) {
            const o = document.createElement("option");
            o.value = String(sl.id);
            o.textContent = fmtSlot(sl.starts_at) + " (" + sl.length_min + " min)";
            sel.appendChild(o);
          });
        });
        renderPrice();
      })
      .catch(function () {
        if (slotSel) { slotSel.innerHTML = '<option value="">Ask Valor to propose a time</option>'; }
      });
  }

  function addPartyRow(defaults) {
    if (!partiesEl || !partyTpl) return;
    const node = partyTpl.content.firstElementChild.cloneNode(true);
    if (defaults) {
      Object.keys(defaults).forEach(function (k) {
        const el = node.querySelector('[data-party="' + k + '"]');
        if (el) el.value = defaults[k];
      });
    }
    node.querySelector(".remove-party").addEventListener("click", function () {
      if (partiesEl.children.length > 1) node.remove();
      else node.querySelectorAll("input").forEach(function (i) { i.value = ""; });
    });
    partiesEl.appendChild(node);
  }

  function collectParties() {
    const out = [];
    if (!partiesEl) return out;
    partiesEl.querySelectorAll(".party-row").forEach(function (row) {
      const get = function (k) { const el = row.querySelector('[data-party="' + k + '"]'); return el ? (el.value || "").trim() : ""; };
      const name = get("name");
      if (!name) return;
      const p = { name: name, role: get("role") || "other", side: get("side") || "neutral" };
      const org = get("organisation");
      if (org) p.organisation = org;
      out.push(p);
    });
    return out;
  }

  function syncConsultUI() {
    const on = isConsult();
    if (consultSection) consultSection.hidden = !on;
    if (divisionHint) divisionHint.hidden = !on;
    if (descLabel) descLabel.hidden = on;
    if (narrLabel) narrLabel.hidden = !on;
    if (descField) {
      descField.required = !on;
      if (on) descField.removeAttribute("minlength"); else descField.setAttribute("minlength", "10");
    }
    if (submitBtn) submitBtn.textContent = on ? "Request Consult & Authorize Card" : "Submit a Matter";
    if (on) {
      loadOffer();
      if (partiesEl && partiesEl.children.length === 0) {
        addPartyRow({ role: "carrier", side: "opposing" });
        addPartyRow({ role: "attorney", side: "neutral" });
      }
    }
  }

  if (divisionSelect) {
    divisionSelect.addEventListener("change", syncConsultUI);
    const audienceParam = new URLSearchParams(window.location.search).get("audience");
    if (audienceParam && audienceSel) audienceSel.value = audienceParam;
    syncConsultUI();
  }
  const addPartyBtn = document.getElementById("add-party");
  if (addPartyBtn) addPartyBtn.addEventListener("click", function () { addPartyRow(); });

  // Back from Stripe Checkout (?consult=requested|cancelled).
  const consultReturn = document.getElementById("consult-return");
  const consultParam = new URLSearchParams(window.location.search).get("consult");
  if (consultReturn && consultParam === "requested") {
    consultReturn.hidden = false;
    consultReturn.textContent = "Thank you — your card is authorized (not charged) and your Rapid Consult request is with Valor. We will email you our decision within a few business days; the email includes a secure link if you would like to share documents ahead of the call.";
  } else if (consultReturn && consultParam === "cancelled") {
    consultReturn.hidden = false;
    consultReturn.textContent = "Your card was not authorized and no consult was requested. You can start again below whenever you are ready.";
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
    "submitter_role", "submitter_role_other",
    "property_name", "property_street", "property_city",
    "property_state", "property_zip",
    "type_of_occurrence", "date_of_occurrence"
  ];

  // The spine types `date_of_occurrence` as a real date and rejects the whole
  // submission (422) on anything it cannot parse. The field is shown in the
  // firm's MM.DD.YYYY convention, so convert to the ISO YYYY-MM-DD the spine
  // wants. Anything unrecognizable is DROPPED, never sent: an approximate date
  // must not be able to bounce a legitimate matter.
  function toIsoDate(raw) {
    const v = (raw || "").trim();
    if (!v) return "";
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return m[1] + "-" + pad2(m[2]) + "-" + pad2(m[3]);
    m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (m) return m[3] + "-" + pad2(m[1]) + "-" + pad2(m[2]);
    return "";
  }
  function pad2(n) { return String(n).length < 2 ? "0" + n : String(n); }

  function submitConsult(fd) {
    const parties = collectParties();
    if (parties.length === 0) {
      showStatus("error", "Please list at least one other involved party (carrier, adjuster, attorney, contractor or owner).");
      return;
    }
    const scopeOk = document.getElementById("accepts_scope");
    const embargoOk = document.getElementById("accepts_embargo_terms");
    if (!(scopeOk && scopeOk.checked && embargoOk && embargoOk.checked)) {
      showStatus("error", "Please acknowledge the scope and payment terms to continue.");
      return;
    }
    const payload = {
      first_name: (fd.get("first_name") || "").trim(),
      last_name: (fd.get("last_name") || "").trim(),
      email: (fd.get("email") || "").trim(),
      company_website: fd.get("company_website") || "",
      page_loaded_at: fd.get("page_loaded_at") || "",
      cf_token: turnstileToken,
      consult_audience: fd.get("consult_audience") || "other",
      claim_stage: fd.get("claim_stage") || "unknown",
      parties: parties,
      accepts_scope: true,
      accepts_embargo_terms: true
    };
    ["phone", "company", "referral_source", "incident_state", "incident_city",
     "submitter_role", "submitter_role_other", "property_name", "property_street",
     "property_city", "property_state", "property_zip", "type_of_occurrence"].forEach(function (name) {
      const v = (fd.get(name) || "").trim();
      if (v) payload[name] = v;
    });
    const iso = toIsoDate(fd.get("date_of_occurrence"));
    if (iso) payload.date_of_occurrence = iso;
    // The narrative is EMBARGOED — sent under its own key, never as `description`.
    const narrative = (fd.get("description") || "").trim();
    if (narrative) payload.narrative = narrative;
    const slot = fd.get("requested_slot_id");
    if (slot) payload.requested_slot_id = Number(slot);
    const alt = fd.get("requested_slot_alt_id");
    if (alt && alt !== slot) payload.requested_slot_alt_id = Number(alt);

    submitBtn.disabled = true;
    showStatus("pending", "Sending your request…");
    fetch(SPINE_API + "/public/consult/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (result.ok && result.data && result.data.checkout_url) {
          showStatus("pending", "Taking you to our secure payment page…");
          window.location.assign(result.data.checkout_url);
          return;
        }
        if (result.ok && result.data && result.data.accepted) {
          form.reset();
          showStatus("success", result.data.message || "Thank you — we'll be in touch.");
          return;
        }
        submitBtn.disabled = false;
        showStatus("error", (result.data && result.data.message) || "We couldn't submit your request just now. Please try again in a moment, or call us at 918.970.4722.");
      })
      .catch(function () {
        submitBtn.disabled = false;
        showStatus("error", "We couldn't submit your request just now. Please try again in a moment, or call us at 918.970.4722.");
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    const fd = new FormData(form);
    if (isConsult()) { submitConsult(fd); return; }
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

    // Date of occurrence: normalize MM.DD.YYYY to ISO, or omit it entirely.
    if (payload.date_of_occurrence) {
      const iso = toIsoDate(payload.date_of_occurrence);
      if (iso) {
        payload.date_of_occurrence = iso;
      } else {
        // Keep what they typed — in the description, where free text belongs —
        // rather than losing it or failing the submission.
        delete payload.date_of_occurrence;
        const typed = (fd.get("date_of_occurrence") || "").trim();
        if (typed) {
          payload.description = payload.description +
            "\n\nDate the damage occurred, as entered: " + typed;
        }
      }
    }

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
