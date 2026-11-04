/**
 * OWS Process TT (TT11) Form Script: Load Ring from CMDB Site into 'ringshow'
 * Directory: /Volumes/LVNPC/HUAWEI/PROJECT/Incident Ticket Monitor/tt11 script/
 * File: load_ring_from_cmdb_site.js
 *
 * Alur Kerja:
 * 1. Mengambil 'siteid' dari Trouble Ticket:
 *    - Membaca komponen form OWS: S('siteid'), S('site_id'), atau S('site').
 *    - Membaca elemen input DOM terkait siteid.
 *    - Jika belum ter-render di form, query live tiket via tt_troubleticket_get berdasarkan orderid.
 * 2. Lookup ke CMDB Site via service resmi OWS:
 *    - Primary:   /adc-service/rest/v1/services/c_datahub/cmdb/cmdb_site_get
 *    - Secondary: /adc-service/rest/v1/services/datahub/cmdb/cmdb_site_get
 *    - Payload:   { id: siteid } atau { site_id: siteid } (mendukung UUID maupun Site Code).
 * 3. Mengambil nilai field 'ring' dari record CMDB Site.
 * 4. Memasukkan nilai ring ke komponen form 'ringshow' (S('ringshow')) secara native & reaktif.
 * 5. Mendaftarkan EventBus / Change Listener pada 'siteid' agar otomatis re-lookup jika user mengubah site.
 */

(function () {
    "use strict";

    var SERVICE_CMDB_SITE_PRIMARY = "/adc-service/rest/v1/services/c_datahub/cmdb/cmdb_site_get";
    var SERVICE_CMDB_SITE_SECONDARY = "/adc-service/rest/v1/services/datahub/cmdb/cmdb_site_get";
    var SERVICE_TT_GET = "/adc-service/rest/v1/services/TroubleTicket/TroubleTicket/tt_troubleticket_get";

    var TARGET_COMP_ID = "ringshow";

    var state = {
        currentSiteId: "",
        resolvedRing: "",
        isLoading: false
    };

    // =========================================================================
    // 1. RESOLVE TICKET ORDER ID & SITE ID
    // =========================================================================

    function getTicketOrderId() {
        // Cek URL parameters
        var urlCandidates = [window.location.search, window.location.href];
        try { if (window.parent) urlCandidates.push(window.parent.location.search, window.parent.location.href); } catch (eP) { }
        try { if (window.top) urlCandidates.push(window.top.location.search, window.top.location.href); } catch (eT) { }

        for (var j = 0; j < urlCandidates.length; j++) {
            var urlStr = urlCandidates[j] || "";
            var m = urlStr.match(/[?&]order_?id=([^&#]+)/i);
            if (m && m[1]) return decodeURIComponent(m[1]).trim();
            var mInc = urlStr.match(/(INC|PMA)-\d{8}-\d+/i);
            if (mInc) return mInc[0].trim();
        }

        // Cek OWS form component
        try {
            if (typeof S === "function") {
                var comps = ["orderid", "order_id"];
                for (var i = 0; i < comps.length; i++) {
                    var c = S(comps[i]);
                    if (c && c.getValue) {
                        var val = c.getValue();
                        if (val && typeof val === "string" && val.trim().length > 0) {
                            var strVal = val.trim();
                            if (!/^[0-9a-f]{16,36}-[0-9a-f]+/i.test(strVal)) return strVal;
                        } else if (val && typeof val === "object") {
                            var objVal = (val.orderid || val.order_id || val.id || val.value || "").toString().trim();
                            if (objVal && !/^[0-9a-f]{16,36}-[0-9a-f]+/i.test(objVal)) return objVal;
                        }
                    }
                }
            }
        } catch (eComp) { }

        return "";
    }

    function getTroubleTicketSiteId() {
        // 1. Coba baca dari komponen form OWS S('siteid') / S('site_id')
        try {
            if (typeof S === "function") {
                var compCandidates = ["siteid", "site_id", "site_code", "site"];
                for (var i = 0; i < compCandidates.length; i++) {
                    var comp = S(compCandidates[i]);
                    if (comp && typeof comp.getValue === "function") {
                        var val = comp.getValue();
                        if (val && typeof val === "string" && val.trim().length > 0) {
                            return val.trim();
                        }
                        if (Array.isArray(val) && val.length > 0) {
                            var first = val[0];
                            var itemVal = (first.id || first.site_id || first.value || first.siteid || first || "").toString().trim();
                            if (itemVal) return itemVal;
                        }
                        if (val && typeof val === "object") {
                            var objVal = (val.id || val.site_id || val.value || val.siteid || "").toString().trim();
                            if (objVal) return objVal;
                        }
                    }
                }
            }
        } catch (eS) { }

        // 2. Coba baca dari input DOM
        try {
            var selector = "#siteid input, input#siteid, [id*='siteid'] input, input[name='siteid'], #site_id input, input#site_id, [id*='site_id'] input";
            var el = document.querySelector(selector);
            if (el && el.value && el.value.trim().length > 0) {
                return el.value.trim();
            }
        } catch (eDom) { }

        return "";
    }

    // =========================================================================
    // 2. EXTRACT FIELD 'ring' DARI RECORD CMDB SITE
    // =========================================================================

    function extractRingFromRow(row) {
        if (!row || typeof row !== "object") return "";

        // Cari kandidat field 'ring'
        var keys = ["ring", "ring_name", "ring_id", "ringname", "RING", "ring_code"];
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (row[k] !== undefined && row[k] !== null) {
                var v = row[k];
                if (typeof v === "object") {
                    var inner = v.displayValue || v.label || v.name || v.value || v.id || "";
                    if (inner) return String(inner).trim();
                } else {
                    var s = String(v).trim();
                    if (s.length > 0) return s;
                }
            }
        }
        return "";
    }

    function parseCmdbResponseRow(res) {
        if (!res) return null;
        if (res.result) {
            return Array.isArray(res.result) ? res.result[0] : res.result;
        }
        if (res.results) {
            return Array.isArray(res.results) ? res.results[0] : res.results;
        }
        if (res.data) {
            return Array.isArray(res.data) ? res.data[0] : res.data;
        }
        if (res.returnObj) {
            return Array.isArray(res.returnObj) ? res.returnObj[0] : res.returnObj;
        }
        if (typeof res === "object" && !Array.isArray(res)) {
            return res;
        }
        return null;
    }

    // =========================================================================
    // 3. SET VALUE KE KOMPONEN 'ringshow'
    // =========================================================================

    function setRingshowValue(ringVal) {
        var displayVal = (ringVal !== undefined && ringVal !== null && String(ringVal).trim().length > 0)
            ? String(ringVal).trim()
            : "-";

        state.resolvedRing = displayVal;
        console.log("[ProcessTT RingLoader] Setting '" + TARGET_COMP_ID + "' =>", displayVal);

        var isSet = false;

        // 1. OWS Component S(TARGET_COMP_ID)
        try {
            if (typeof S === "function" && S(TARGET_COMP_ID)) {
                var comp = S(TARGET_COMP_ID);
                if (typeof comp.setValue === "function") {
                    comp.setValue(displayVal);
                    isSet = true;
                } else if (typeof comp.setText === "function") {
                    comp.setText(displayVal);
                    isSet = true;
                }

                if (typeof Spl !== "undefined" && Spl.EventBus && Spl.EventBus.dispatch) {
                    Spl.EventBus.dispatch(TARGET_COMP_ID, "ValueChange", { value: displayVal });
                }
            }
        } catch (eS) { }

        // 2. DOM fallback
        try {
            var el = document.getElementById(TARGET_COMP_ID) || document.querySelector("[id*='" + TARGET_COMP_ID + "']");
            if (el) {
                if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
                    el.value = displayVal;
                    var evt = document.createEvent("HTMLEvents");
                    evt.initEvent("change", true, false);
                    el.dispatchEvent(evt);
                } else {
                    el.innerText = displayVal;
                }
                isSet = true;
            }
        } catch (eDom) { }

        return isSet;
    }

    function retrySetRingshow(ringVal, maxRetries) {
        var retries = 0;
        var limit = maxRetries || 12;
        var timer = setInterval(function () {
            retries++;
            var success = setRingshowValue(ringVal);
            if (success || retries >= limit) {
                clearInterval(timer);
                if (success) {
                    console.log("[ProcessTT RingLoader] Successfully bound ring to '" + TARGET_COMP_ID + "' on retry #" + retries);
                } else {
                    console.warn("[ProcessTT RingLoader] Reached max retries. Could not locate component '" + TARGET_COMP_ID + "'.");
                }
            }
        }, 350);
    }

    // =========================================================================
    // 4. LOOKUP CMDB_SITE
    // =========================================================================

    function lookupRingBySiteId(siteId, callback) {
        var targetSiteId = String(siteId || "").trim();
        if (!targetSiteId) {
            console.warn("[ProcessTT RingLoader] lookup skipped: siteId is empty.");
            if (callback) callback("");
            return;
        }

        if (state.isLoading) return;
        state.isLoading = true;
        state.currentSiteId = targetSiteId;

        console.log("[ProcessTT RingLoader] Looking up cmdb_site for siteid:", targetSiteId);

        if (typeof MessageProcessor === "undefined" || !MessageProcessor.process) {
            console.warn("[ProcessTT RingLoader] MessageProcessor is not defined.");
            state.isLoading = false;
            if (callback) callback("");
            return;
        }

        // Jalur 1: Coba lookup by id (UUID) pada endpoint primary
        MessageProcessor.process({
            serviceId: SERVICE_CMDB_SITE_PRIMARY,
            data: { id: targetSiteId },
            success: function (res) {
                var row = parseCmdbResponseRow(res);
                var ring = extractRingFromRow(row);

                if (ring) {
                    state.isLoading = false;
                    retrySetRingshow(ring);
                    if (callback) callback(ring);
                    return;
                }

                // Jalur 2: Jika kosong dengan id, coba query by site_id (Site Code)
                console.log("[ProcessTT RingLoader] Empty ring with { id }, retrying with { site_id }:", targetSiteId);
                MessageProcessor.process({
                    serviceId: SERVICE_CMDB_SITE_PRIMARY,
                    data: { site_id: targetSiteId },
                    success: function (res2) {
                        var row2 = parseCmdbResponseRow(res2);
                        var ring2 = extractRingFromRow(row2);

                        if (ring2) {
                            state.isLoading = false;
                            retrySetRingshow(ring2);
                            if (callback) callback(ring2);
                            return;
                        }

                        // Jalur 3: Coba endpoint secondary (/datahub/cmdb/cmdb_site_get)
                        trySecondaryService(targetSiteId, callback);
                    },
                    error: function () {
                        trySecondaryService(targetSiteId, callback);
                    }
                });
            },
            error: function () {
                trySecondaryService(targetSiteId, callback);
            }
        });
    }

    function trySecondaryService(targetSiteId, callback) {
        console.log("[ProcessTT RingLoader] Retrying with secondary service:", SERVICE_CMDB_SITE_SECONDARY);
        MessageProcessor.process({
            serviceId: SERVICE_CMDB_SITE_SECONDARY,
            data: { id: targetSiteId, site_id: targetSiteId },
            success: function (resSec) {
                state.isLoading = false;
                var rowSec = parseCmdbResponseRow(resSec);
                var ringSec = extractRingFromRow(rowSec);
                retrySetRingshow(ringSec || "-");
                if (callback) callback(ringSec || "");
            },
            error: function (errSec) {
                state.isLoading = false;
                console.warn("[ProcessTT RingLoader] All cmdb_site_get lookup attempts failed:", errSec);
                retrySetRingshow("-");
                if (callback) callback("");
            }
        });
    }

    // =========================================================================
    // 5. MAIN ORCHESTRATION & EVENT LISTENERS
    // =========================================================================

    function initRingLoader() {
        var siteId = getTroubleTicketSiteId();
        console.log("[ProcessTT RingLoader] Initial resolved siteid from form:", siteId);

        if (siteId) {
            lookupRingBySiteId(siteId);
        } else {
            // Jika form belum siap, coba dapatkan dari trouble ticket live query via orderid
            var orderId = getTicketOrderId();
            console.log("[ProcessTT RingLoader] siteid not yet in form, checking orderid:", orderId);

            if (orderId && typeof MessageProcessor !== "undefined" && MessageProcessor.process) {
                MessageProcessor.process({
                    serviceId: SERVICE_TT_GET,
                    data: { orderid: orderId },
                    success: function (res) {
                        var tt = (res && res.result) ? res.result : (res && res.data ? res.data : null);
                        if (tt) {
                            var sid = tt.siteid || tt.site_id || tt.sitecode || tt.site_code || "";
                            if (sid) {
                                console.log("[ProcessTT RingLoader] Found siteid from TroubleTicket query:", sid);
                                lookupRingBySiteId(sid);
                                return;
                            }
                        }
                        // Retry check dari form jika data baru di-load oleh OWS BPM
                        setTimeout(function () {
                            var retrySid = getTroubleTicketSiteId();
                            if (retrySid) lookupRingBySiteId(retrySid);
                        }, 1200);
                    },
                    error: function () {
                        setTimeout(function () {
                            var retrySid = getTroubleTicketSiteId();
                            if (retrySid) lookupRingBySiteId(retrySid);
                        }, 1200);
                    }
                });
            } else {
                setTimeout(function () {
                    var retrySid = getTroubleTicketSiteId();
                    if (retrySid) lookupRingBySiteId(retrySid);
                }, 1200);
            }
        }

        // Registrasi listener jika operator memilih atau mengubah siteid di form
        registerSiteIdListeners();
    }

    function registerSiteIdListeners() {
        if (window.__pttRingListenerRegistered) return;
        window.__pttRingListenerRegistered = true;

        // Spl.EventBus listener (OWS component value change)
        if (typeof Spl !== "undefined" && Spl.EventBus && Spl.EventBus.register) {
            var watchComps = ["siteid", "site_id", "site_code", "site"];
            watchComps.forEach(function (compId) {
                try {
                    Spl.EventBus.register(compId, "ValueChange", function (eventData) {
                        var changedVal = "";
                        if (eventData) {
                            changedVal = (typeof eventData === "string")
                                ? eventData
                                : (eventData.value || eventData.id || eventData.site_id || "");
                        }
                        var targetSid = (changedVal || getTroubleTicketSiteId() || "").trim();
                        if (targetSid && targetSid !== state.currentSiteId) {
                            console.log("[ProcessTT RingLoader] EventBus ValueChange on '" + compId + "':", targetSid);
                            lookupRingBySiteId(targetSid);
                        }
                    });
                } catch (eBus) { }
            });
        }

        // DOM change listener
        try {
            var selector = "#siteid input, input#siteid, [id*='siteid'] input, #site_id input";
            var inputs = document.querySelectorAll(selector);
            for (var i = 0; i < inputs.length; i++) {
                inputs[i].addEventListener("change", function () {
                    var sid = getTroubleTicketSiteId();
                    if (sid && sid !== state.currentSiteId) {
                        console.log("[ProcessTT RingLoader] DOM input change detected:", sid);
                        lookupRingBySiteId(sid);
                    }
                });
            }
        } catch (eDom) { }
    }

    // =========================================================================
    // 6. GLOBAL DEBUG HELPER
    // =========================================================================

    /**
     * Diagnostic helper untuk DevTools Console:
     * Penggunaan:
     *   window.debugPttRing()               -> Lookup menggunakan siteid yang ada di form
     *   window.debugPttRing("SITE-UUID/ID") -> Lookup langsung dengan custom siteid
     */
    window.debugPttRing = function (customSiteId) {
        var sid = (customSiteId || state.currentSiteId || getTroubleTicketSiteId() || "").trim();
        console.group("[ProcessTT RingLoader Debugger]");
        console.log("Current state.currentSiteId:", state.currentSiteId);
        console.log("Current state.resolvedRing :", state.resolvedRing);
        console.log("Target siteid to query     :", sid);

        if (!sid) {
            console.error("siteid is EMPTY! Cannot lookup cmdb_site.");
            console.groupEnd();
            return;
        }

        lookupRingBySiteId(sid, function (ring) {
            console.log("Lookup completed! Field 'ring' value =>", ring);
            console.groupEnd();
        });
    };

    // =========================================================================
    // 7. INITIALIZATION BOOTSTRAPPER
    // =========================================================================

    if (typeof U !== "undefined" && typeof U.ready === "function") {
        U.ready(function () {
            initRingLoader();
            setTimeout(initRingLoader, 600);
            setTimeout(initRingLoader, 1600);
        });
    } else if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
            initRingLoader();
            setTimeout(initRingLoader, 600);
            setTimeout(initRingLoader, 1600);
        });
    } else {
        initRingLoader();
        setTimeout(initRingLoader, 600);
        setTimeout(initRingLoader, 1600);
    }
})();
