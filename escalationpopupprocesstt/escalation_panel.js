/**
 * Process TT (TT11) Escalation Level & Support Popup Module
 * Directory: /Volumes/LVNPC/HUAWEI/PROJECT/Incident Ticket Monitor/escalationpopupprocesstt/
 * Files: escalation_panel.html, escalation_panel.css, escalation_panel.js
 *
 * Features:
 * 1. Displays current Escalation Level (1-5), SLA Aging Blink Indicator, and Need Support status inside Process TT HTML Panel.
 * 2. Opens a Ticket Monitor-style Popup Modal dedicated to Escalation Level & Support + Escalation History Log + Excel Export.
 * 3. Enforces sequential escalation rules (1 -> 2 -> 3 -> 4 -> 5), no rollback, and mandatory reason input.
 * 4. Syncs updates to:
 *    - `incwo_update_tt_info` (local monitor + `incwo_escalation_log` + `tt_troubleticket`)
 *    - `c_TroubleTicket/TroubleTicket/tt_update` (direct page-level safeguard for tickets)
 *    - Live Process TT form fields: `incident_chronology`, `showescalationlevel`, `showescalationsupport`, `escalation_recordtext`
 *    - BroadcastChannel (`ows_inc_ticket_sync_v1`) to notify open Ticket Monitor tabs.
 */

(function () {
    "use strict";

    var SERVICE_DETAIL = "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_query_tt_detail";
    var SERVICE_UPDATE = "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_update_tt_info";
    var SERVICE_TT_UPDATE = "/adc-service/rest/v1/services/c_TroubleTicket/TroubleTicket/tt_update";
    var SERVICE_LOG_TEXT = "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_get_escalation_log_text";
    var SERVICE_ESC_LOG_GET_LIST = "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_escalation_log_get_list";
    var SERVICE_ESC_LOG_GET = "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_escalation_log_get";
    var SERVICE_INCLINK_GET = "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/LinkDownTicketMonitor/inclink_linkdownticketmonitor_get";
    var SERVICE_INCLINK_UPDATE = "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/LinkDownTicketMonitor/inclink_linkdownticketmonitor_update";

    var SYNC_CHANNEL_NAME = "ows_inc_ticket_sync_v1";
    var SYNC_STORAGE_KEY = "ows_inc_ticket_sync_event_v1";

    var state = {
        orderId: "",
        currentUser: "",
        escalationLevel: 0,
        escalationSupport: "NO_NEED",
        agingTimeStr: "",
        alarmTimeStr: "",
        escalationHistory: [],
        pendingEscalationLevel: null,
        pendingSupportStatus: null,
        modalMouseDownTarget: null,
        toastTimer: null,
        syncChannel: null,
        existsInInclink: false
    };

    // =========================================================================
    // HELPER UTILITIES
    // =========================================================================
    function escapeHtml(str) {
        if (str === null || str === undefined) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function extractOWSField(val) {
        if (val === null || val === undefined) return "";
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
            return String(val);
        }
        if (typeof val === "object") {
            return val.value || val.displayValue || val.label || val.name || val.id || "";
        }
        return "";
    }

    function formatTimeToUTC7(input) {
        if (!input) return "-";
        var d = input instanceof Date ? input : null;
        if (!d) {
            var str = String(input).trim();
            if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(str)) {
                return str.length === 16 ? str + ":00" : str;
            }
            d = new Date(str.replace(/-/g, "/"));
        }
        if (isNaN(d.getTime())) return String(input);
        var pad = function (n) { return n < 10 ? "0" + n : String(n); };
        return (
            d.getFullYear() + "-" +
            pad(d.getMonth() + 1) + "-" +
            pad(d.getDate()) + " " +
            pad(d.getHours()) + ":" +
            pad(d.getMinutes()) + ":" +
            pad(d.getSeconds())
        );
    }

    function parseAgingToMinutes(agingStr) {
        if (!agingStr || typeof agingStr !== "string") return 0;
        var total = 0;
        var hMatch = agingStr.match(/(\d+)\s*hour/i);
        if (hMatch && hMatch[1]) total += parseInt(hMatch[1], 10) * 60;
        var mMatch = agingStr.match(/(\d+)\s*minute/i);
        if (mMatch && mMatch[1]) total += parseInt(mMatch[1], 10);
        return total;
    }

    function getEscalationBlinkMap(agingMinutes, currentLevel) {
        var aging = typeof agingMinutes === "number" ? agingMinutes : 0;
        var cur = typeof currentLevel === "number" ? currentLevel : 0;
        var blinkMap = {};
        if (cur < 1 && aging > 30) blinkMap[1] = true;
        if (cur < 2 && aging > 90) blinkMap[2] = true;
        if (cur < 3 && aging > 170) blinkMap[3] = true;
        if (cur < 4 && aging > 230) blinkMap[4] = true;
        if (cur < 5 && aging > 470) blinkMap[5] = true;
        return blinkMap;
    }

    function showToast(message, isSuccess) {
        var toast = document.getElementById("pttEscToast");
        if (!toast) return;
        toast.textContent = message;
        toast.className = "ptt-esc-toast show " + (isSuccess ? "toast-success" : "toast-error");
        if (state.toastTimer) clearTimeout(state.toastTimer);
        state.toastTimer = setTimeout(function () {
            toast.className = "ptt-esc-toast";
        }, 3200);
    }

    function getOperatorName() {
        if (state.currentUser) return state.currentUser;
        try {
            if (typeof _runtime !== "undefined" && _runtime && _runtime.userName) {
                return String(_runtime.userName).trim();
            }
            if (window.currentUser) return String(window.currentUser).trim();
            if (window.parent && window.parent.currentUser) return String(window.parent.currentUser).trim();
        } catch (e) { }
        return "Operator";
    }

    function getTicketOrderId() {
        // 1. Check URL parameters in window / parent / top (most authoritative in BPM submit panel)
        var urlCandidates = [window.location.search, window.location.href];
        try { if (window.parent) urlCandidates.push(window.parent.location.search, window.parent.location.href); } catch (eP) { }
        try { if (window.top) urlCandidates.push(window.top.location.search, window.top.location.href); } catch (eT) { }

        for (var j = 0; j < urlCandidates.length; j++) {
            var urlStr = urlCandidates[j] || "";
            var m = urlStr.match(/[?&]order_?id=([^&#]+)/i);
            if (m && m[1]) {
                var dec = decodeURIComponent(m[1]).trim();
                if (dec) return dec;
            }
            var mInc = urlStr.match(/(INC|PMA)-\d{8}-\d+/i);
            if (mInc) return mInc[0].trim();
        }

        // 2. Check OWS form component S('orderid') / S('order_id')
        try {
            if (typeof S === "function") {
                var compCandidates = ["orderid", "order_id"];
                for (var i = 0; i < compCandidates.length; i++) {
                    var comp = S(compCandidates[i]);
                    if (comp && comp.getValue) {
                        var val = comp.getValue();
                        if (val && typeof val === "string" && val.trim().length > 0) {
                            var strVal = val.trim();
                            // Guard: ignore raw internal 32-hex workflow UUIDs
                            if (!/^[0-9a-f]{16,36}-[0-9a-f]+/i.test(strVal)) {
                                return strVal;
                            }
                        } else if (Array.isArray(val) && val.length > 0) {
                            var itemVal = (val[0].orderid || val[0].order_id || val[0].id || val[0].value || val[0] || "").toString().trim();
                            if (itemVal && !/^[0-9a-f]{16,36}-[0-9a-f]+/i.test(itemVal)) return itemVal;
                        } else if (val && typeof val === "object") {
                            var objVal = (val.orderid || val.order_id || val.id || val.value || "").toString().trim();
                            if (objVal && !/^[0-9a-f]{16,36}-[0-9a-f]+/i.test(objVal)) return objVal;
                        }
                    }
                }
            }
        } catch (eComp) { }

        // 3. Fallback search in body text
        try {
            var bodyText = document.body ? document.body.innerText : "";
            var matchInc = bodyText.match(/(INC|PMA)-\d{8}-\d+/);
            if (matchInc) return matchInc[0].trim();
        } catch (eDom) { }

        return "";
    }

    // =========================================================================
    // OWS FORM COMPONENT SYNC HELPERS (TT11)
    // =========================================================================
    function setOwsComponentValue(compId, val) {
        try {
            if (typeof S === "function" && S(compId)) {
                var comp = S(compId);
                if (typeof comp.setValue === "function") {
                    comp.setValue(val);
                } else if (typeof comp.setText === "function") {
                    comp.setText(val);
                }
                if (typeof Spl !== "undefined" && Spl.EventBus && Spl.EventBus.dispatch) {
                    Spl.EventBus.dispatch(compId, "ValueChange", { value: val });
                }
            }
        } catch (eS) { }

        try {
            var elem = document.getElementById(compId);
            if (elem) {
                if (elem.tagName === "INPUT" || elem.tagName === "TEXTAREA" || elem.tagName === "SELECT") {
                    elem.value = val;
                    var evt = document.createEvent("HTMLEvents");
                    evt.initEvent("change", true, false);
                    elem.dispatchEvent(evt);
                } else {
                    elem.innerText = val;
                }
            }
        } catch (eDom) { }
    }

    function getLiveProcessTTChronology() {
        // Read current incident_chronology from Process TT form if available
        try {
            if (typeof S === "function" && S("incident_chronology")) {
                var c = S("incident_chronology");
                if (c && typeof c.getValue === "function") {
                    var v = c.getValue();
                    if (typeof v === "string") return v;
                }
            }
        } catch (e) { }

        try {
            var el = document.querySelector('textarea[id*="incident_chronology"], #incident_chronology textarea, #incident_chronology');
            if (el && typeof el.value === "string") {
                return el.value;
            }
        } catch (e2) { }

        return null;
    }

    function prependToProcessTTChronology(newLogLine, callback) {
        var formChronology = getLiveProcessTTChronology();
        var existing = (formChronology !== null && typeof formChronology === "string") ? formChronology.trim() : "";
        var updated = existing ? (newLogLine + "\n" + existing) : newLogLine;
        setOwsComponentValue("incident_chronology", updated);
        if (callback) callback(updated);
    }

    function refreshProcessTTFormEscalationFields() {
        var lvl = Number(state.escalationLevel || 0);
        var levelDisplay = lvl > 0 ? ("Level " + lvl) : "No Escalation";
        var suppDisplay = state.escalationSupport === "NEED" ? "Need Support" : "No Need Support";

        setOwsComponentValue("showescalationlevel", levelDisplay);
        setOwsComponentValue("showescalationsupport", suppDisplay);
        if (lvl > 0) setOwsComponentValue("escalationlevelnumber", lvl);
        setOwsComponentValue("escalationsupport", state.escalationSupport);

        // Also refresh escalation_recordtext on Process TT form
        if (state.orderId && typeof MessageProcessor !== "undefined" && MessageProcessor.process) {
            MessageProcessor.process({
                serviceId: SERVICE_LOG_TEXT,
                data: { orderid: state.orderId },
                success: function (res) {
                    var textVal = (res && res.escalation_recordtext) ? res.escalation_recordtext : "-";
                    setOwsComponentValue("escalation_recordtext", textVal);
                },
                error: function () { }
            });
        }
    }

    function broadcastSavedSignal() {
        if (!state.orderId) return;
        var payload = {
            type: "PROCESS_TT_SAVED",
            orderid: String(state.orderId).trim().toUpperCase(),
            source: "PROCESS_TT",
            operator: getOperatorName(),
            ts: Date.now()
        };
        try {
            if (state.syncChannel) state.syncChannel.postMessage(payload);
        } catch (eBc) { }
        try {
            localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(payload));
        } catch (eSt) { }
    }

    // =========================================================================
    // DYNAMIC ANIMATIONS & MODAL DOM RENDERING
    // =========================================================================
    function injectDynamicAnimations() {
        if (document.getElementById("pttEscKeyframesStyle")) return;
        var styleEl = document.createElement("style");
        styleEl.id = "pttEscKeyframesStyle";
        styleEl.textContent =
            "@keyframes pttNeedSupportBlink {" +
            "  0%, 3% { background-color: #ffffff; border-color: #dcdfe6; color: #dc2626; }" +
            "  3.1%, 100% { background-color: #dc2626; border-color: #dc2626; color: #ffffff; }" +
            "}" +
            "@keyframes pttEscDoubleBlinkAlert {" +
            "  0%, 80%, 100% { background-color: #ffffff; border-color: #dcdfe6; color: #606266; box-shadow: none; }" +
            "  83% { background-color: #dc2626; border-color: #dc2626; color: #ffffff; box-shadow: 0 0 6px rgba(220, 38, 38, 0.6); }" +
            "  87% { background-color: #ffffff; border-color: #dcdfe6; color: #606266; box-shadow: none; }" +
            "  91% { background-color: #dc2626; border-color: #dc2626; color: #ffffff; box-shadow: 0 0 6px rgba(220, 38, 38, 0.6); }" +
            "  95% { background-color: #ffffff; border-color: #dcdfe6; color: #606266; box-shadow: none; }" +
            "}";
        document.head.appendChild(styleEl);
    }

    function renderInlineCardDOM() {
        var wrapper = document.getElementById("pttEscWrapper");
        if (!wrapper) {
            wrapper = document.querySelector(".ptt-esc-wrapper") ||
                      document.querySelector('[id*="html_panel"]') ||
                      document.querySelector('.html-panel');
            if (wrapper && !wrapper.id) wrapper.id = "pttEscWrapper";
        }
        if (!wrapper) return;

        if (!document.getElementById("pttEscInlineCard")) {
            wrapper.innerHTML =
                '<div class="ptt-esc-inline-card" id="pttEscInlineCard">' +
                '  <div class="ptt-esc-inline-left" onclick="window.openPttEscalationPopup()">' +
                '    <div class="ptt-esc-inline-title-row">' +
                '      <span class="ptt-esc-inline-label">Escalation Level &amp; Support</span>' +
                '      <span class="ptt-esc-summary-badge" id="pttEscInlineLevelBadge">No Level</span>' +
                '    </div>' +
                '    <div class="ptt-esc-inline-dots-row">' +
                '      <div class="ptt-esc-dots-group" id="pttEscInlineDots">' +
                '        <span class="ptt-esc-dot" id="pttEscInlineDot1" title="Level 1">1</span>' +
                '        <span class="ptt-esc-dot" id="pttEscInlineDot2" title="Level 2">2</span>' +
                '        <span class="ptt-esc-dot" id="pttEscInlineDot3" title="Level 3">3</span>' +
                '        <span class="ptt-esc-dot" id="pttEscInlineDot4" title="Level 4">4</span>' +
                '        <span class="ptt-esc-dot" id="pttEscInlineDot5" title="Level 5">5</span>' +
                '      </div>' +
                '      <span class="ptt-esc-inline-hint" id="pttEscInlineHint">Click to manage escalation level &amp; support</span>' +
                '    </div>' +
                '  </div>' +
                '  <div class="ptt-esc-inline-right" onclick="event.stopPropagation()">' +
                '    <button type="button" class="ptt-esc-support-btn support-no-need" id="pttEscInlineSupportBtn" onclick="window.openPttEscalationPopupAndToggleSupport()">' +
                '      <span id="pttEscInlineSupportText">No Need Support</span>' +
                '    </button>' +
                '    <button type="button" class="ptt-esc-open-btn" id="pttEscOpenModalBtn" onclick="window.openPttEscalationPopup()">' +
                '      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '        <path d="M12 20h9"></path>' +
                '        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>' +
                '      </svg>' +
                '      <span>Edit Escalation</span>' +
                '    </button>' +
                '  </div>' +
                '</div>' +
                '<div id="pttEscMainModalPlaceholder"></div>' +
                '<div id="pttEscConfirmLevelModalPlaceholder"></div>' +
                '<div id="pttEscConfirmSupportModalPlaceholder"></div>' +
                '<div class="ptt-esc-toast" id="pttEscToast"></div>';
        }
    }

    function renderMainModalDOM() {
        var placeholder = document.getElementById("pttEscMainModalPlaceholder");
        if (!placeholder || placeholder.dataset.rendered === "true") return;
        placeholder.dataset.rendered = "true";

        placeholder.innerHTML =
            '<div class="ptt-esc-modal-overlay" id="pttEscMainModal" onmousedown="window.recordPttEscMouseDown(event)" onclick="window.closePttEscalationPopupOnBackdrop(event)">' +
            '  <div class="ptt-esc-modal-dialog">' +
            '    <div class="ptt-esc-modal-header">' +
            '      <div class="ptt-esc-header-title-group">' +
            '        <span class="ptt-esc-modal-title">Escalation Level &amp; Support</span>' +
            '      </div>' +
            '      <button type="button" class="ptt-esc-close-btn" onclick="window.closePttEscalationPopup()">&#10005;</button>' +
            '    </div>' +
            '    <div class="ptt-esc-modal-body">' +
            '      <div class="ptt-esc-section-box">' +
            '        <div class="ptt-esc-section-top">' +
            '          <div class="ptt-esc-section-top-left">' +
            '            <span class="ptt-esc-section-label">Escalation Status</span>' +
            '            <span class="ptt-esc-summary-badge" id="pttEscModalSummaryBadge">No Level</span>' +
            '            <span class="ptt-esc-aging-badge" id="pttEscModalAgingBadge">Aging: -</span>' +
            '          </div>' +
            '          <div>' +
            '            <button type="button" class="ptt-esc-support-btn support-no-need" id="pttEscModalSupportBtn" onclick="window.togglePttSupportStatus()">' +
            '              <span id="pttEscModalSupportText">No Need Support</span>' +
            '            </button>' +
            '          </div>' +
            '        </div>' +
            '        <div class="ptt-esc-steps-row">' +
            '          <button type="button" class="ptt-esc-step-btn" id="pttEscStepBtn1" onclick="window.setPttEscalationLevel(1)">' +
            '            <span class="step-indicator"></span><span>Level 1</span>' +
            '          </button>' +
            '          <button type="button" class="ptt-esc-step-btn" id="pttEscStepBtn2" onclick="window.setPttEscalationLevel(2)">' +
            '            <span class="step-indicator"></span><span>Level 2</span>' +
            '          </button>' +
            '          <button type="button" class="ptt-esc-step-btn" id="pttEscStepBtn3" onclick="window.setPttEscalationLevel(3)">' +
            '            <span class="step-indicator"></span><span>Level 3</span>' +
            '          </button>' +
            '          <button type="button" class="ptt-esc-step-btn" id="pttEscStepBtn4" onclick="window.setPttEscalationLevel(4)">' +
            '            <span class="step-indicator"></span><span>Level 4</span>' +
            '          </button>' +
            '          <button type="button" class="ptt-esc-step-btn" id="pttEscStepBtn5" onclick="window.setPttEscalationLevel(5)">' +
            '            <span class="step-indicator"></span><span>Level 5</span>' +
            '          </button>' +
            '        </div>' +
            '        <div class="ptt-esc-history-container" id="pttEscHistoryLogContainer">' +
            '          <span>No escalation history recorded.</span>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '    <div class="ptt-esc-modal-footer">' +
            '      <button type="button" class="ptt-esc-btn-cancel" onclick="window.closePttEscalationPopup()">Close</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';
    }

    function renderConfirmLevelModalDOM() {
        var placeholder = document.getElementById("pttEscConfirmLevelModalPlaceholder");
        if (!placeholder || placeholder.dataset.rendered === "true") return;
        placeholder.dataset.rendered = "true";

        placeholder.innerHTML =
            '<div class="ptt-esc-modal-overlay is-confirm-overlay" id="pttEscConfirmLevelModal" onmousedown="window.recordPttEscMouseDown(event)" onclick="window.closePttConfirmLevelOnBackdrop(event)">' +
            '  <div class="ptt-esc-modal-dialog ptt-esc-dialog-md">' +
            '    <div class="ptt-esc-modal-header">' +
            '      <span class="ptt-esc-modal-title">Confirm Escalation</span>' +
            '      <button type="button" class="ptt-esc-close-btn" onclick="window.closePttConfirmLevelModal()">&#10005;</button>' +
            '    </div>' +
            '    <div class="ptt-esc-modal-body">' +
            '      <div class="ptt-esc-confirm-row">' +
            '        <div class="ptt-esc-confirm-icon">' +
            '          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>' +
            '        </div>' +
            '        <div class="ptt-esc-confirm-message">' +
            '          Are you sure you want to escalate this ticket to <strong id="pttEscPendingLevelTargetText" style="color: #2563eb;">Level -</strong>?<br>' +
            '          <span style="font-size: 12px; color: #64748b; margin-top: 2px; display: block;">This action will be recorded in the escalation log and injected into the ticket chronology.</span>' +
            '        </div>' +
            '      </div>' +
            '      <div class="ptt-esc-field">' +
            '        <label class="ptt-esc-label">Reason / Description <span style="color: #ef4444;">*</span></label>' +
            '        <textarea class="ptt-esc-textarea" id="pttEscLevelReasonInput" rows="4" placeholder="Enter reason / description for escalating this level (mandatory)..."></textarea>' +
            '      </div>' +
            '    </div>' +
            '    <div class="ptt-esc-modal-footer">' +
            '      <button type="button" class="ptt-esc-btn-cancel" onclick="window.closePttConfirmLevelModal()">Cancel</button>' +
            '      <button type="button" class="ptt-esc-btn-submit" id="pttEscConfirmLevelBtn" onclick="window.executePttConfirmedEscalation()">Confirm</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';
    }

    function renderConfirmSupportModalDOM() {
        var placeholder = document.getElementById("pttEscConfirmSupportModalPlaceholder");
        if (!placeholder || placeholder.dataset.rendered === "true") return;
        placeholder.dataset.rendered = "true";

        placeholder.innerHTML =
            '<div class="ptt-esc-modal-overlay is-confirm-overlay" id="pttEscConfirmSupportModal" onmousedown="window.recordPttEscMouseDown(event)" onclick="window.closePttConfirmSupportOnBackdrop(event)">' +
            '  <div class="ptt-esc-modal-dialog ptt-esc-dialog-md">' +
            '    <div class="ptt-esc-modal-header">' +
            '      <span class="ptt-esc-modal-title" id="pttEscSupportModalTitle">Update Support Status</span>' +
            '      <button type="button" class="ptt-esc-close-btn" onclick="window.closePttConfirmSupportModal()">&#10005;</button>' +
            '    </div>' +
            '    <div class="ptt-esc-modal-body">' +
            '      <div class="ptt-esc-confirm-row">' +
            '        <div class="ptt-esc-confirm-icon" id="pttEscSupportModalIcon">' +
            '          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
            '        </div>' +
            '        <div class="ptt-esc-confirm-message">' +
            '          Change support status for this ticket to <strong id="pttEscPendingSupportTargetText">-</strong>?<br>' +
            '          <span style="font-size: 12px; color: #64748b; margin-top: 2px; display: block;">This status change will be recorded in the escalation log and ticket chronology.</span>' +
            '        </div>' +
            '      </div>' +
            '      <div class="ptt-esc-field">' +
            '        <label class="ptt-esc-label">Reason / Description <span style="color: #ef4444;">*</span></label>' +
            '        <textarea class="ptt-esc-textarea" id="pttEscSupportReasonInput" rows="4" placeholder="Enter reason / description for changing support status (mandatory)..."></textarea>' +
            '      </div>' +
            '    </div>' +
            '    <div class="ptt-esc-modal-footer">' +
            '      <button type="button" class="ptt-esc-btn-cancel" onclick="window.closePttConfirmSupportModal()">Cancel</button>' +
            '      <button type="button" class="ptt-esc-btn-submit" id="pttEscConfirmSupportBtn" onclick="window.executePttConfirmedSupport()">Confirm</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';
    }

    // =========================================================================
    // UI RENDERING & DATA LOADING
    // =========================================================================
    function getAgingMinutes() {
        var agingMin = parseAgingToMinutes(state.agingTimeStr);
        if (agingMin === 0 && state.alarmTimeStr) {
            try {
                var parsedAlarm = new Date(state.alarmTimeStr.replace(/-/g, "/"));
                if (!isNaN(parsedAlarm.getTime())) {
                    var diffMs = Math.max(0, Date.now() - parsedAlarm.getTime());
                    agingMin = Math.floor(diffMs / (1000 * 60));
                }
            } catch (eAl) { }
        }
        return agingMin;
    }

    function updateEscalationUI() {
        var currentLevel = Number(state.escalationLevel || 0);
        var isNeed = state.escalationSupport === "NEED";
        var agingMinutes = getAgingMinutes();
        var blinkMap = getEscalationBlinkMap(agingMinutes, currentLevel);

        // 1. Update Inline Card
        var inlineTicketEl = document.getElementById("pttEscInlineTicketId");
        if (inlineTicketEl) inlineTicketEl.textContent = state.orderId || "-";

        var inlineBadge = document.getElementById("pttEscInlineLevelBadge");
        if (inlineBadge) {
            inlineBadge.textContent = currentLevel > 0 ? ("Level " + currentLevel) : "No Level";
            inlineBadge.className = "ptt-esc-summary-badge" + (currentLevel > 0 ? (" is-active-l" + currentLevel) : "");
        }

        for (var d = 1; d <= 5; d++) {
            var dotEl = document.getElementById("pttEscInlineDot" + d);
            if (dotEl) {
                var dActive = d <= currentLevel;
                var dBlink = !dActive && Boolean(blinkMap[d]);
                var dotClass = "ptt-esc-dot";
                if (dActive) dotClass += " is-active-l" + d;
                else if (dBlink) dotClass += " blink-alert";
                dotEl.className = dotClass;
            }
        }

        var inlineSuppBtn = document.getElementById("pttEscInlineSupportBtn");
        var inlineSuppText = document.getElementById("pttEscInlineSupportText");
        if (inlineSuppBtn) {
            inlineSuppBtn.className = "ptt-esc-support-btn " + (isNeed ? "support-need" : "support-no-need");
        }
        if (inlineSuppText) {
            inlineSuppText.textContent = isNeed ? "Need Support" : "No Need Support";
        }

        // 2. Update Main Popup Modal
        var modalOrderEl = document.getElementById("pttEscModalOrderId");
        if (modalOrderEl) modalOrderEl.textContent = state.orderId || "-";

        var modalBadge = document.getElementById("pttEscModalSummaryBadge");
        if (modalBadge) {
            modalBadge.textContent = currentLevel > 0 ? ("Level " + currentLevel) : "No Level";
            modalBadge.className = "ptt-esc-summary-badge" + (currentLevel > 0 ? (" is-active-l" + currentLevel) : "");
        }

        var agingBadge = document.getElementById("pttEscModalAgingBadge");
        if (agingBadge) {
            if (state.agingTimeStr) {
                agingBadge.textContent = "Aging: " + state.agingTimeStr;
            } else if (agingMinutes > 0) {
                var hrs = Math.floor(agingMinutes / 60);
                var mins = agingMinutes % 60;
                agingBadge.textContent = "Aging: " + hrs + "h " + mins + "m";
            } else {
                agingBadge.textContent = "Aging: -";
            }
        }

        for (var lvl = 1; lvl <= 5; lvl++) {
            var stepBtn = document.getElementById("pttEscStepBtn" + lvl);
            if (stepBtn) {
                var isActive = lvl <= currentLevel;
                var isBlinking = !isActive && Boolean(blinkMap[lvl]);
                var btnClass = "ptt-esc-step-btn";
                if (isActive) btnClass += " is-active-l" + lvl;
                else if (isBlinking) btnClass += " blink-alert-l" + lvl;
                stepBtn.className = btnClass;
            }
        }

        var modalSuppBtn = document.getElementById("pttEscModalSupportBtn");
        var modalSuppText = document.getElementById("pttEscModalSupportText");
        if (modalSuppBtn) {
            modalSuppBtn.className = "ptt-esc-support-btn " + (isNeed ? "support-need" : "support-no-need");
        }
        if (modalSuppText) {
            modalSuppText.textContent = isNeed ? "Need Support" : "No Need Support";
        }

        // 3. Render Escalation History Log
        var histContainer = document.getElementById("pttEscHistoryLogContainer");
        if (histContainer) {
            var historyList = state.escalationHistory || [];
            if (historyList.length === 0) {
                histContainer.innerHTML = "<span>No escalation history recorded.</span>";
            } else {
                var htmlHist =
                    '<div class="ptt-esc-history-header">' +
                    '  <span style="font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">Escalation Logs (' + historyList.length + ')</span>' +
                    '  <button type="button" class="ptt-esc-btn-export" id="pttEscBtnExportLog" onclick="window.exportPttEscalationLogsToExcel()">' +
                    '    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                    '    <span>Export Log</span>' +
                    '  </button>' +
                    '</div>';

                historyList.forEach(function (item) {
                    htmlHist += '<div class="ptt-esc-history-item">';
                    htmlHist += '  <div class="ptt-esc-history-main-row">';
                    var lType = String(item.log_type || item.type || "").toUpperCase();
                    var isSupport = (lType === "NEED_SUPPORT" || lType === "SUPPORT");

                    if (isSupport) {
                        var st = item.support_status || item.status;
                        var isNeedSupp = String(st).toUpperCase() === "NEED";
                        var badgeBg = isNeedSupp ? "#dc2626" : "#16a34a";
                        var label = isNeedSupp ? "Need Support" : "No Need Support";
                        htmlHist += '    <span style="color: #ffffff; background: ' + badgeBg + '; padding: 2px 7px; border-radius: 4px; font-weight: 700; font-size: 11px;">' + label + '</span>';
                        htmlHist += '    <span>Set at ' + escapeHtml(formatTimeToUTC7(item.time || item.create_time)) + ' by <strong style="color: #2563eb;">' + escapeHtml(item.by || item.operator_name || "-") + '</strong></span>';
                    } else {
                        var lvlVal = item.esc_level !== undefined && item.esc_level !== null ? item.esc_level : (item.level !== undefined ? item.level : "-");
                        htmlHist += '    <span class="ptt-esc-summary-badge is-active-l' + lvlVal + '" style="font-size: 11px; padding: 2px 7px; font-weight: 700;">Level ' + lvlVal + '</span>';
                        htmlHist += '    <span>Triggered at ' + escapeHtml(formatTimeToUTC7(item.time || item.create_time)) + ' by <strong style="color: #2563eb;">' + escapeHtml(item.by || item.operator_name || "-") + '</strong></span>';
                    }
                    htmlHist += '  </div>';

                    var desc = item.description || item.note || "";
                    if (desc) {
                        htmlHist += '  <div class="ptt-esc-history-note-row">"' + escapeHtml(desc) + '"</div>';
                    }
                    htmlHist += '</div>';
                });

                histContainer.innerHTML = htmlHist;
            }
        }
    }

    function fetchEscalationHistoryLogs(orderId, callback) {
        var targetId = String(orderId || state.orderId || getTicketOrderId() || "").trim();
        if (!targetId || typeof MessageProcessor === "undefined" || !MessageProcessor.process) {
            if (callback) callback(state.escalationHistory || []);
            return;
        }

        var reqPayload = {
            orderid: targetId,
            condition: { orderid: targetId },
            start: 0,
            limit: 100
        };

        MessageProcessor.process({
            serviceId: SERVICE_ESC_LOG_GET_LIST,
            data: reqPayload,
            success: function (res) {
                // Ignore response if user switched to another ticket
                if (String(state.orderId).trim().toUpperCase() !== targetId.toUpperCase()) return;

                var rawList = [];
                if (res) {
                    if (Array.isArray(res)) {
                        rawList = res;
                    } else if (Array.isArray(res.results)) {
                        rawList = res.results;
                    } else if (Array.isArray(res.result)) {
                        rawList = res.result;
                    } else if (Array.isArray(res.data)) {
                        rawList = res.data;
                    } else if (Array.isArray(res.list)) {
                        rawList = res.list;
                    }
                }

                // STRICT FILTER: Match strictly by the active ticket orderid
                var normTargetId = targetId.toUpperCase();
                var ticketLogs = rawList.filter(function (row) {
                    if (!row) return false;
                    var rId = String(row.orderid || row.order_id || row.orderId || "").trim().toUpperCase();
                    return rId === normTargetId;
                });

                if (ticketLogs.length > 0) {
                    var maxLogLevel = 0;
                    var latestSuppStatus = null;
                    var mappedLogs = ticketLogs.map(function (row) {
                        var lType = String(row.log_type || row.type || "").toUpperCase();
                        var lNum = Number(row.esc_level !== undefined && row.esc_level !== null ? row.esc_level : (row.level !== undefined ? row.level : 0));
                        if (lType.indexOf("ESCALATION") !== -1 && !isNaN(lNum) && lNum > maxLogLevel) {
                            maxLogLevel = lNum;
                        }
                        if (lType === "NEED_SUPPORT" || lType === "SUPPORT" || row.support_status) {
                            var suppRaw = String(row.support_status || row.status || "").toUpperCase();
                            if (suppRaw === "NEED" || suppRaw === "NEED SUPPORT") {
                                latestSuppStatus = "NEED";
                            } else if (suppRaw === "NO_NEED" || suppRaw === "NO NEED" || suppRaw === "NO NEED SUPPORT") {
                                latestSuppStatus = "NO_NEED";
                            }
                        }
                        var opName = row.operator_name || row.by || row.operator_id || "Operator";
                        if (typeof opName === "string" && opName.indexOf("(") !== -1) {
                            opName = opName.split("(")[0].trim();
                        }
                        return {
                            id: row.id,
                            orderid: targetId,
                            log_type: row.log_type || row.type || (lNum > 0 ? "ESCALATION_LEVEL" : "NEED_SUPPORT"),
                            level: lNum,
                            esc_level: lNum,
                            support_status: row.support_status || row.status || "",
                            status: row.support_status || row.status || "",
                            time: row.create_time || row.time || "",
                            create_time: row.create_time || row.time || "",
                            operator_id: row.operator_id || "",
                            operator_name: opName,
                            by: opName,
                            description: row.description || row.note || "",
                            note: row.description || row.note || ""
                        };
                    });

                    // Sort chronologically (earliest to latest)
                    mappedLogs.sort(function (a, b) {
                        var tA = a.create_time ? new Date(String(a.create_time).replace(/-/g, "/")).getTime() : 0;
                        var tB = b.create_time ? new Date(String(b.create_time).replace(/-/g, "/")).getTime() : 0;
                        return tA - tB;
                    });

                    state.escalationHistory = mappedLogs;
                    if (maxLogLevel > 0 && maxLogLevel > state.escalationLevel) {
                        state.escalationLevel = maxLogLevel;
                    }
                    if (latestSuppStatus && latestSuppStatus !== state.escalationSupport) {
                        state.escalationSupport = latestSuppStatus;
                    }
                } else {
                    // This ticket has no logs
                    state.escalationHistory = [];
                }

                updateEscalationUI();
                refreshProcessTTFormEscalationFields();
                if (callback) callback(state.escalationHistory);
            },
            error: function () {
                if (callback) callback(state.escalationHistory || []);
            }
        });
    }

    function loadTicketEscalationData(orderId) {
        var targetId = String(orderId || getTicketOrderId() || "").trim();
        if (!targetId) return;

        // Clean state reset for target ticket to avoid stale cross-ticket data
        state.orderId = targetId;
        state.escalationLevel = 0;
        state.escalationSupport = "NO_NEED";
        state.escalationHistory = [];
        state.agingTimeStr = "";
        state.alarmTimeStr = "";
        state.pendingEscalationLevel = null;
        state.pendingSupportStatus = null;
        updateEscalationUI();

        if (typeof MessageProcessor === "undefined" || !MessageProcessor.process) return;

        // 1. Direct query to incwo_escalation_log_get_list for dedicated log history
        fetchEscalationHistoryLogs(targetId);

        // 2. Query from incwo_query_tt_detail (returns detail + current_user + escalation_logs)
        MessageProcessor.process({
            serviceId: SERVICE_DETAIL,
            data: { orderid: targetId },
            success: function (res) {
                // Ensure response is for currently active ticket
                if (String(state.orderId).trim().toUpperCase() !== targetId.toUpperCase()) return;

                if (res && res.current_user) {
                    state.currentUser = res.current_user;
                }
                var detail = (res && res.data) ? res.data : {};
                var rawLogs = (res && Array.isArray(res.escalation_logs)) ? res.escalation_logs : [];

                // Filter logs to match this ticket only
                var normTargetId = targetId.toUpperCase();
                var logs = rawLogs.filter(function (row) {
                    if (!row) return false;
                    var rId = String(row.orderid || row.order_id || row.orderId || "").trim().toUpperCase();
                    return rId === normTargetId;
                });

                if (logs.length > 0 && (!state.escalationHistory || state.escalationHistory.length === 0)) {
                    var maxLogLevel = 0;
                    state.escalationHistory = logs.map(function (row) {
                        var lType = String(row.log_type || "").toUpperCase();
                        var lNum = Number(row.esc_level || 0);
                        if (lType.indexOf("ESCALATION") !== -1 && !isNaN(lNum) && lNum > maxLogLevel) {
                            maxLogLevel = lNum;
                        }
                        return {
                            log_type: row.log_type,
                            level: row.esc_level,
                            esc_level: row.esc_level,
                            support_status: row.support_status,
                            time: row.create_time,
                            create_time: row.create_time,
                            operator_id: row.operator_id || "",
                            operator_name: row.operator_name || row.by || "",
                            by: row.operator_name || row.operator_id || "Operator",
                            description: row.description || "",
                            note: row.description || ""
                        };
                    });
                    if (maxLogLevel > state.escalationLevel) {
                        state.escalationLevel = maxLogLevel;
                    }
                }

                var dLevel = Number(extractOWSField(detail.escalationlevelnumber) || 0);
                if (isNaN(dLevel)) dLevel = 0;
                if (dLevel > state.escalationLevel) {
                    state.escalationLevel = dLevel;
                }

                var suppRaw = String(extractOWSField(detail.escalationsupport) || "").toUpperCase();
                if (suppRaw === "NEED" || suppRaw === "NEED SUPPORT") {
                    state.escalationSupport = "NEED";
                } else if (suppRaw) {
                    state.escalationSupport = "NO_NEED";
                }

                if (detail.aging_time) state.agingTimeStr = extractOWSField(detail.aging_time);
                if (detail.alarm_time) state.alarmTimeStr = extractOWSField(detail.alarm_time);

                updateEscalationUI();
                refreshProcessTTFormEscalationFields();
            },
            error: function () { }
        });

        // 3. Check if ticket also exists in inclink_linkdownticketmonitor
        MessageProcessor.process({
            serviceId: SERVICE_INCLINK_GET,
            data: { orderid: targetId },
            success: function (res) {
                if (res && res.result && (res.result.orderid || res.result.id)) {
                    state.existsInInclink = true;
                }
            },
            error: function () { }
        });
    }

    // =========================================================================
    // INTERACTION HANDLERS (GLOBAL WINDOW EXPORTS FOR HTML ONCLICK)
    // =========================================================================
    window.recordPttEscMouseDown = function (e) {
        state.modalMouseDownTarget = e.target;
    };

    window.openPttEscalationPopup = function () {
        renderInlineCardDOM();
        renderMainModalDOM();
        renderConfirmLevelModalDOM();
        renderConfirmSupportModalDOM();

        var latestId = getTicketOrderId();
        if (latestId && latestId !== state.orderId) {
            loadTicketEscalationData(latestId);
        } else {
            // Always fetch the freshest logs when modal opens
            fetchEscalationHistoryLogs(state.orderId || latestId);
            updateEscalationUI();
        }

        var modal = document.getElementById("pttEscMainModal");
        if (modal) modal.style.display = "flex";
    };

    window.openPttEscalationPopupAndToggleSupport = function () {
        window.openPttEscalationPopup();
        window.togglePttSupportStatus();
    };

    window.closePttEscalationPopup = function () {
        var modal = document.getElementById("pttEscMainModal");
        if (modal) modal.style.display = "none";
    };

    window.closePttEscalationPopupOnBackdrop = function (e) {
        if (e.target && e.target.id === "pttEscMainModal" && state.modalMouseDownTarget === e.target) {
            window.closePttEscalationPopup();
        }
        state.modalMouseDownTarget = null;
    };

    window.setPttEscalationLevel = function (targetLevel) {
        targetLevel = Number(targetLevel);
        var currentLevel = Number(state.escalationLevel || 0);

        // Rule 1: Sequential escalation only (1 -> 2 -> 3 -> 4 -> 5)
        if (targetLevel > currentLevel + 1) {
            var nextAllowed = currentLevel + 1;
            showToast("Sequential order required! Please select Level " + nextAllowed + " first.", false);
            return;
        }

        // Rule 2: No rollback allowed
        if (targetLevel < currentLevel) {
            showToast("Rollback is not allowed. Escalation level cannot be downgraded.", false);
            return;
        }

        renderConfirmLevelModalDOM();
        state.pendingEscalationLevel = targetLevel;

        var targetText = document.getElementById("pttEscPendingLevelTargetText");
        var isRepeat = (targetLevel === currentLevel);
        if (targetText) {
            targetText.textContent = "Level " + targetLevel + (isRepeat ? " (Add Log / Progress)" : "");
        }

        var reasonInput = document.getElementById("pttEscLevelReasonInput");
        if (reasonInput) reasonInput.value = "";

        var mainModal = document.getElementById("pttEscMainModal");
        if (mainModal) mainModal.style.display = "none";

        var modal = document.getElementById("pttEscConfirmLevelModal");
        if (modal) modal.style.display = "flex";
    };

    window.closePttConfirmLevelModal = function () {
        var modal = document.getElementById("pttEscConfirmLevelModal");
        if (modal) modal.style.display = "none";
        state.pendingEscalationLevel = null;

        var mainModal = document.getElementById("pttEscMainModal");
        if (mainModal) mainModal.style.display = "flex";
    };

    window.closePttConfirmLevelOnBackdrop = function (e) {
        if (e.target && e.target.id === "pttEscConfirmLevelModal" && state.modalMouseDownTarget === e.target) {
            window.closePttConfirmLevelModal();
        }
        state.modalMouseDownTarget = null;
    };

    window.executePttConfirmedEscalation = function () {
        var targetLevel = state.pendingEscalationLevel;
        if (!targetLevel) {
            window.closePttConfirmLevelModal();
            return;
        }

        var reasonInput = document.getElementById("pttEscLevelReasonInput");
        var reasonText = reasonInput ? reasonInput.value.trim() : "";
        if (!reasonText) {
            showToast("Reason / Description is mandatory for escalation.", false);
            if (reasonInput) reasonInput.focus();
            return;
        }

        var orderId = state.orderId || getTicketOrderId();
        if (!orderId) {
            showToast("Order ID not found on this page.", false);
            return;
        }

        var confirmBtn = document.getElementById("pttEscConfirmLevelBtn");
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = "Saving...";
        }

        var now = new Date();
        var timeStr = formatTimeToUTC7(now);
        var currentUser = getOperatorName();
        var padZero = function (n) { return n < 10 ? "0" + n : String(n); };
        var timeHHmm = padZero(now.getHours()) + ":" + padZero(now.getMinutes());
        var logLine = timeHHmm + " [ESCALATION LEVEL " + targetLevel + "] " + reasonText + " (Operator " + currentUser + ")";

        var curSupp = state.escalationSupport || "NO_NEED";
        var newEscLog = {
            orderid: orderId,
            log_type: "ESCALATION_LEVEL",
            level: targetLevel,
            esc_level: targetLevel,
            support_status: curSupp,
            status: curSupp,
            time: timeStr,
            create_time: timeStr,
            by: currentUser,
            operator_name: currentUser,
            description: reasonText,
            note: reasonText
        };

        prependToProcessTTChronology(logLine, function (updatedChronology) {
            var payloadData = {
                orderid: orderId,
                escalationlevelnumber: targetLevel,
                tt_action: updatedChronology,
                new_logs: [newEscLog]
            };

            MessageProcessor.process({
                serviceId: SERVICE_UPDATE,
                data: { orderid: orderId, data: payloadData },
                success: function () {
                    if (confirmBtn) {
                        confirmBtn.disabled = false;
                        confirmBtn.textContent = "Confirm";
                    }

                    // Direct safeguard update to tt_troubleticket via tt_update
                    MessageProcessor.process({
                        serviceId: SERVICE_TT_UPDATE,
                        data: {
                            orderid: orderId,
                            order_id: orderId,
                            escalationlevelnumber: targetLevel,
                            incident_chronology: updatedChronology
                        },
                        success: function () { },
                        error: function (err) {
                            console.warn("[ProcessTT Escalation] tt_update error:", err);
                        }
                    });

                    // Sync to Link Down Ticket Monitor if present there
                    if (state.existsInInclink) {
                        MessageProcessor.process({
                            serviceId: SERVICE_INCLINK_UPDATE,
                            data: {
                                orderid: orderId,
                                escalationlevelnumber: targetLevel,
                                tt_action: updatedChronology
                            },
                            success: function () { },
                            error: function () { }
                        });
                    }

                    state.escalationLevel = targetLevel;
                    state.escalationHistory = state.escalationHistory || [];
                    state.escalationHistory.push(newEscLog);

                    if (reasonInput) reasonInput.value = "";
                    window.closePttConfirmLevelModal();
                    updateEscalationUI();
                    refreshProcessTTFormEscalationFields();
                    broadcastSavedSignal();
                    fetchEscalationHistoryLogs(orderId);
                    showToast("Escalated to Level " + targetLevel + " & injected into chronology!", true);
                },
                error: function (err) {
                    if (confirmBtn) {
                        confirmBtn.disabled = false;
                        confirmBtn.textContent = "Confirm";
                    }
                    showToast("Escalation failed: " + ((err && err.message) || "Unknown error"), false);
                }
            });
        });
    };

    window.togglePttSupportStatus = function () {
        var currentSupp = state.escalationSupport || "NO_NEED";
        var targetSupp = currentSupp === "NEED" ? "NO_NEED" : "NEED";

        renderConfirmSupportModalDOM();
        state.pendingSupportStatus = targetSupp;

        var targetText = document.getElementById("pttEscPendingSupportTargetText");
        var modalTitle = document.getElementById("pttEscSupportModalTitle");
        var modalIcon = document.getElementById("pttEscSupportModalIcon");
        var reasonInput = document.getElementById("pttEscSupportReasonInput");

        if (reasonInput) reasonInput.value = "";
        if (targetSupp === "NEED") {
            if (targetText) {
                targetText.textContent = "Need Support";
                targetText.style.color = "#f56c6c";
            }
            if (modalTitle) modalTitle.textContent = "Request Support";
            if (modalIcon) {
                modalIcon.style.backgroundColor = "#fef0f0";
                modalIcon.style.color = "#f56c6c";
            }
        } else {
            if (targetText) {
                targetText.textContent = "No Need Support";
                targetText.style.color = "#67c23a";
            }
            if (modalTitle) modalTitle.textContent = "Cancel Support Request";
            if (modalIcon) {
                modalIcon.style.backgroundColor = "#f0f9eb";
                modalIcon.style.color = "#67c23a";
            }
        }

        var mainModal = document.getElementById("pttEscMainModal");
        if (mainModal) mainModal.style.display = "none";

        var modal = document.getElementById("pttEscConfirmSupportModal");
        if (modal) modal.style.display = "flex";
    };

    window.closePttConfirmSupportModal = function () {
        var modal = document.getElementById("pttEscConfirmSupportModal");
        if (modal) modal.style.display = "none";
        state.pendingSupportStatus = null;

        var mainModal = document.getElementById("pttEscMainModal");
        if (mainModal) mainModal.style.display = "flex";
    };

    window.closePttConfirmSupportOnBackdrop = function (e) {
        if (e.target && e.target.id === "pttEscConfirmSupportModal" && state.modalMouseDownTarget === e.target) {
            window.closePttConfirmSupportModal();
        }
        state.modalMouseDownTarget = null;
    };

    // =========================================================================
    // KEYBOARD NAVIGATION (ESCAPE KEY TO CLOSE POPUPS)
    // =========================================================================
    function handleGlobalEscKey(e) {
        if (!e) e = window.event;
        var key = e.key || e.keyCode;
        if (key === "Escape" || key === "Esc" || key === 27) {
            var confirmSuppModal = document.getElementById("pttEscConfirmSupportModal");
            if (confirmSuppModal && (confirmSuppModal.style.display === "flex" || confirmSuppModal.offsetHeight > 0)) {
                window.closePttConfirmSupportModal();
                if (e.stopPropagation) e.stopPropagation();
                if (e.preventDefault) e.preventDefault();
                return;
            }

            var confirmLevelModal = document.getElementById("pttEscConfirmLevelModal");
            if (confirmLevelModal && (confirmLevelModal.style.display === "flex" || confirmLevelModal.offsetHeight > 0)) {
                window.closePttConfirmLevelModal();
                if (e.stopPropagation) e.stopPropagation();
                if (e.preventDefault) e.preventDefault();
                return;
            }

            var mainModal = document.getElementById("pttEscMainModal");
            if (mainModal && (mainModal.style.display === "flex" || mainModal.offsetHeight > 0)) {
                window.closePttEscalationPopup();
                if (e.stopPropagation) e.stopPropagation();
                if (e.preventDefault) e.preventDefault();
                return;
            }
        }
    }

    if (!window._pttEscKeydownAttached) {
        document.addEventListener("keydown", handleGlobalEscKey, true);
        window._pttEscKeydownAttached = true;
    }

    window.executePttConfirmedSupport = function () {
        var targetSupp = state.pendingSupportStatus;
        if (!targetSupp) {
            window.closePttConfirmSupportModal();
            return;
        }

        var reasonInput = document.getElementById("pttEscSupportReasonInput");
        var reasonText = reasonInput ? reasonInput.value.trim() : "";
        if (!reasonText) {
            showToast("Reason / Description is mandatory for support status update.", false);
            if (reasonInput) reasonInput.focus();
            return;
        }

        var orderId = state.orderId || getTicketOrderId();
        if (!orderId) {
            showToast("Order ID not found on this page.", false);
            return;
        }

        var confirmBtn = document.getElementById("pttEscConfirmSupportBtn");
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = "Saving...";
        }

        var now = new Date();
        var timeStr = formatTimeToUTC7(now);
        var currentUser = getOperatorName();
        var padZero = function (n) { return n < 10 ? "0" + n : String(n); };
        var timeHHmm = padZero(now.getHours()) + ":" + padZero(now.getMinutes());
        var tagLabel = targetSupp === "NEED" ? "NEED SUPPORT" : "NO NEED SUPPORT";
        var logLine = timeHHmm + " [" + tagLabel + "] " + reasonText + " (Operator " + currentUser + ")";

        var curLvl = Number(state.escalationLevel || 0);
        var newSuppLog = {
            orderid: orderId,
            log_type: "NEED_SUPPORT",
            type: "SUPPORT",
            level: curLvl,
            esc_level: curLvl,
            support_status: targetSupp,
            status: targetSupp,
            time: timeStr,
            create_time: timeStr,
            by: currentUser,
            operator_name: currentUser,
            description: reasonText,
            note: reasonText
        };

        prependToProcessTTChronology(logLine, function (updatedChronology) {
            var payloadData = {
                orderid: orderId,
                escalationsupport: targetSupp,
                tt_action: updatedChronology,
                new_logs: [newSuppLog]
            };

            MessageProcessor.process({
                serviceId: SERVICE_UPDATE,
                data: { orderid: orderId, data: payloadData },
                success: function () {
                    if (confirmBtn) {
                        confirmBtn.disabled = false;
                        confirmBtn.textContent = "Confirm";
                    }

                    // Direct safeguard update to tt_troubleticket via tt_update
                    MessageProcessor.process({
                        serviceId: SERVICE_TT_UPDATE,
                        data: {
                            orderid: orderId,
                            order_id: orderId,
                            escalationsupport: targetSupp,
                            incident_chronology: updatedChronology
                        },
                        success: function () { },
                        error: function (err) {
                            console.warn("[ProcessTT Escalation] tt_update error:", err);
                        }
                    });

                    // Sync to Link Down Ticket Monitor if present there
                    if (state.existsInInclink) {
                        MessageProcessor.process({
                            serviceId: SERVICE_INCLINK_UPDATE,
                            data: {
                                orderid: orderId,
                                escalationsupport: targetSupp,
                                tt_action: updatedChronology
                            },
                            success: function () { },
                            error: function () { }
                        });
                    }

                    state.escalationSupport = targetSupp;
                    state.escalationHistory = state.escalationHistory || [];
                    state.escalationHistory.push(newSuppLog);

                    if (reasonInput) reasonInput.value = "";
                    window.closePttConfirmSupportModal();
                    updateEscalationUI();
                    refreshProcessTTFormEscalationFields();
                    broadcastSavedSignal();
                    fetchEscalationHistoryLogs(orderId);
                    showToast("Support status updated to " + (targetSupp === "NEED" ? "Need Support" : "No Need Support") + "!", true);
                },
                error: function (err) {
                    if (confirmBtn) {
                        confirmBtn.disabled = false;
                        confirmBtn.textContent = "Confirm";
                    }
                    showToast("Support status update failed: " + ((err && err.message) || "Unknown error"), false);
                }
            });
        });
    };

    // =========================================================================
    // NATIVE EXCEL (.XLSX) EXPORT FOR ESCALATION LOGS
    // =========================================================================
    var XLSX_CRC_TABLE = (function () {
        var t = [];
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();

    function xlsxCrc32(bytes) {
        var c = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) c = XLSX_CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function xlsxWriteU16(view, off, v) { view.setUint16(off, v, true); }
    function xlsxWriteU32(view, off, v) { view.setUint32(off, v, true); }

    function xlsxUtf8Encode(str) {
        if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
        var out = [];
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c < 128) out.push(c);
            else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
            else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
        }
        return new Uint8Array(out);
    }

    function xlsxEscapeXml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function xlsxColName(i) {
        var s = "";
        i++;
        while (i > 0) {
            var rem = (i - 1) % 26;
            s = String.fromCharCode(65 + rem) + s;
            i = Math.floor((i - 1) / 26);
        }
        return s;
    }

    function xlsxZipStore(files) {
        var chunks = [];
        var central = [];
        var offset = 0;
        for (var i = 0; i < files.length; i++) {
            var nameB = xlsxUtf8Encode(files[i].name);
            var data = files[i].data;
            var crc = xlsxCrc32(data);
            var size = data.length;

            var lh = new DataView(new ArrayBuffer(30));
            xlsxWriteU32(lh, 0, 0x04034b50);
            xlsxWriteU16(lh, 4, 20);
            xlsxWriteU16(lh, 6, 0x0800);
            xlsxWriteU16(lh, 8, 0);
            xlsxWriteU16(lh, 10, 0);
            xlsxWriteU16(lh, 12, 0x21);
            xlsxWriteU32(lh, 14, crc);
            xlsxWriteU32(lh, 18, size);
            xlsxWriteU32(lh, 22, size);
            xlsxWriteU16(lh, 26, nameB.length);
            xlsxWriteU16(lh, 28, 0);
            chunks.push(new Uint8Array(lh.buffer), nameB, data);

            var ch = new DataView(new ArrayBuffer(46));
            xlsxWriteU32(ch, 0, 0x02014b50);
            xlsxWriteU16(ch, 4, 20);
            xlsxWriteU16(ch, 6, 20);
            xlsxWriteU16(ch, 8, 0x0800);
            xlsxWriteU16(ch, 10, 0);
            xlsxWriteU16(ch, 12, 0);
            xlsxWriteU16(ch, 14, 0x21);
            xlsxWriteU32(ch, 16, crc);
            xlsxWriteU32(ch, 20, size);
            xlsxWriteU32(ch, 24, size);
            xlsxWriteU16(ch, 28, nameB.length);
            xlsxWriteU16(ch, 30, 0);
            xlsxWriteU16(ch, 32, 0);
            xlsxWriteU16(ch, 34, 0);
            xlsxWriteU16(ch, 36, 0);
            xlsxWriteU32(ch, 38, 0);
            xlsxWriteU32(ch, 42, offset);
            central.push(new Uint8Array(ch.buffer), nameB);

            offset += 30 + nameB.length + data.length;
        }

        var centralSize = 0;
        for (var j = 0; j < central.length; j++) centralSize += central[j].length;

        var eocd = new DataView(new ArrayBuffer(22));
        xlsxWriteU32(eocd, 0, 0x06054b50);
        xlsxWriteU16(eocd, 4, 0);
        xlsxWriteU16(eocd, 6, 0);
        xlsxWriteU16(eocd, 8, files.length);
        xlsxWriteU16(eocd, 10, files.length);
        xlsxWriteU32(eocd, 12, centralSize);
        xlsxWriteU32(eocd, 16, offset);
        xlsxWriteU16(eocd, 20, 0);

        var total = offset + centralSize + 22;
        var out = new Uint8Array(total);
        var pos = 0;
        var all = chunks.concat(central);
        for (var k = 0; k < all.length; k++) {
            out.set(all[k], pos);
            pos += all[k].length;
        }
        out.set(new Uint8Array(eocd.buffer), pos);
        return out;
    }

    function generateNativeXlsxBytes(headers, rows, sheetName) {
        var sHeaders = headers || [];
        var sRows = rows || [];
        var sName = (sheetName || "Escalation_Log").replace(/[:\\/?*\[\]]/g, "_").slice(0, 31);

        var lastCol = xlsxColName(Math.max(0, sHeaders.length - 1));
        var totalRows = sRows.length + 1;

        var colWidths = sHeaders.map(function (h, colIdx) {
            var maxLen = h.length;
            for (var r = 0; r < sRows.length; r++) {
                var val = sRows[r][colIdx];
                var str = val != null ? String(val) : "";
                if (str.length > maxLen) maxLen = Math.min(str.length, 60);
            }
            return Math.max(maxLen + 4, 12);
        });

        var colsXml = "";
        for (var c = 0; c < colWidths.length; c++) {
            colsXml += '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + colWidths[c] + '" customWidth="1"/>';
        }

        var headerCells = "";
        for (var hIdx = 0; hIdx < sHeaders.length; hIdx++) {
            var hRef = xlsxColName(hIdx) + "1";
            headerCells += '<c r="' + hRef + '" s="1" t="inlineStr"><is><t>' + xlsxEscapeXml(sHeaders[hIdx]) + '</t></is></c>';
        }
        var rowsXml = '<row r="1" ht="26" customHeight="1">' + headerCells + '</row>';

        for (var rIdx = 0; rIdx < sRows.length; rIdx++) {
            var rowNum = rIdx + 2;
            var rowData = sRows[rIdx];
            var cellsXml = "";
            for (var cIdx = 0; cIdx < rowData.length; cIdx++) {
                var cellRef = xlsxColName(cIdx) + rowNum;
                var cellVal = rowData[cIdx];
                var isNumber = typeof cellVal === "number" && !isNaN(cellVal);

                if (cellVal == null) {
                    cellsXml += '<c r="' + cellRef + '" s="2"/>';
                } else if (isNumber) {
                    cellsXml += '<c r="' + cellRef + '" s="2" t="n"><v>' + cellVal + '</v></c>';
                } else {
                    cellsXml += '<c r="' + cellRef + '" s="2" t="inlineStr"><is><t>' + xlsxEscapeXml(String(cellVal)) + '</t></is></c>';
                }
            }
            rowsXml += '<row r="' + rowNum + '" ht="20" customHeight="1">' + cellsXml + '</row>';
        }

        var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<dimension ref="A1:' + lastCol + totalRows + '"/>' +
            '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
            '</sheetView></sheetViews>' +
            '<sheetFormatPr defaultRowHeight="18"/>' +
            '<cols>' + colsXml + '</cols>' +
            '<sheetData>' + rowsXml + '</sheetData>' +
            '</worksheet>';

        var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<fonts count="2">' +
            '<font><sz val="10"/><name val="Segoe UI"/></font>' +
            '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>' +
            '</fonts>' +
            '<fills count="3">' +
            '<fill><patternFill patternType="none"/></fill>' +
            '<fill><patternFill patternType="gray125"/></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/></patternFill></fill>' +
            '</fills>' +
            '<borders count="2">' +
            '<border><left/><right/><top/><bottom/><diagonal/></border>' +
            '<border>' +
            '<left style="thin"><color rgb="FFE5E7EB"/></left>' +
            '<right style="thin"><color rgb="FFE5E7EB"/></right>' +
            '<top style="thin"><color rgb="FFE5E7EB"/></top>' +
            '<bottom style="thin"><color rgb="FFE5E7EB"/></bottom>' +
            '<diagonal/>' +
            '</border>' +
            '</borders>' +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            '<cellXfs count="3">' +
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>' +
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="center"/></xf>' +
            '</cellXfs>' +
            '</styleSheet>';

        var workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<sheets><sheet name="' + sName + '" sheetId="1" r:id="rId1"/></sheets>' +
            '</workbook>';

        var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
            '</Relationships>';

        var wbRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
            '</Relationships>';

        var contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
            '</Types>';

        var files = [
            { name: "[Content_Types].xml", data: xlsxUtf8Encode(contentTypesXml) },
            { name: "_rels/.rels", data: xlsxUtf8Encode(relsXml) },
            { name: "xl/workbook.xml", data: xlsxUtf8Encode(workbookXml) },
            { name: "xl/_rels/workbook.xml.rels", data: xlsxUtf8Encode(wbRelsXml) },
            { name: "xl/styles.xml", data: xlsxUtf8Encode(stylesXml) },
            { name: "xl/worksheets/sheet1.xml", data: xlsxUtf8Encode(sheetXml) }
        ];

        return xlsxZipStore(files);
    }

    window.exportPttEscalationLogsToExcel = function () {
        var orderId = state.orderId || getTicketOrderId() || "Ticket";
        var logs = state.escalationHistory || [];

        if (!logs || logs.length === 0) {
            showToast("No escalation logs to export for this ticket.", false);
            return;
        }

        var btn = document.getElementById("pttEscBtnExportLog");
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Exporting...";
        }

        try {
            var filename = "Escalation_log_" + String(orderId).trim() + ".xlsx";
            var headers = [
                "No",
                "Order ID",
                "Log Type",
                "Escalation Level",
                "Support Status",
                "Description / Reason",
                "User ID",
                "Operator Name",
                "Create Time"
            ];

            var runningLevel = Number(state.escalationLevel || 0);
            var runningSupp = state.escalationSupport || "NO_NEED";

            var rows = logs.map(function (log, idx) {
                var isSupp = log.log_type === "NEED_SUPPORT" || log.type === "SUPPORT" || (log.support_status && log.esc_level === undefined && log.level === undefined);
                var logTypeLabel = isSupp ? "NEED_SUPPORT" : "ESCALATION_LEVEL";

                if (log.esc_level !== undefined && log.esc_level !== null) {
                    runningLevel = Number(log.esc_level);
                } else if (log.level !== undefined && log.level !== null) {
                    runningLevel = Number(log.level);
                }

                if (log.support_status) runningSupp = log.support_status;
                else if (log.status) runningSupp = log.status;

                var rawLvl = log.esc_level !== undefined && log.esc_level !== null ? log.esc_level : (log.level !== undefined && log.level !== null ? log.level : runningLevel);
                var levelLabel = Number(rawLvl) > 0 ? ("Level " + rawLvl) : (runningLevel > 0 ? ("Level " + runningLevel) : "Level 0");

                var rawSupp = log.support_status || log.status || runningSupp || "NO_NEED";
                var suppLabel = (String(rawSupp).toUpperCase() === "NEED" || String(rawSupp).toUpperCase() === "NEED SUPPORT") ? "NEED" : "NO_NEED";

                var desc = log.description || log.note || "-";
                var userId = log.operator_id || (typeof _runtime !== "undefined" && _runtime && _runtime.userName ? _runtime.userName : "-");
                var opName = log.operator_name || log.by || "-";
                var time = formatTimeToUTC7(log.time || log.create_time);

                return [
                    idx + 1,
                    orderId,
                    logTypeLabel,
                    levelLabel,
                    suppLabel,
                    desc,
                    userId,
                    opName,
                    time
                ];
            });

            if (typeof window.XLSX !== "undefined" && window.XLSX.utils && window.XLSX.writeFile) {
                var sheetData = [headers].concat(rows);
                var ws = window.XLSX.utils.aoa_to_sheet(sheetData);
                var wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "Escalation_Log");
                window.XLSX.writeFile(wb, filename);
            } else {
                var bytes = generateNativeXlsxBytes(headers, rows, "Escalation_Log");
                var blob = new Blob([bytes], {
                    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                });
                var url = URL.createObjectURL(blob);
                var a = document.createElement("a");
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(function () {
                    URL.revokeObjectURL(url);
                    if (a.parentNode) a.parentNode.removeChild(a);
                }, 1500);
            }

            showToast("Exported: " + filename, true);
        } catch (e) {
            showToast("Export failed: " + (e.message || "Unknown error"), false);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> <span>Export Log</span>';
            }
        }
    };

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    function initPttEscalationPanel() {
        injectDynamicAnimations();
        renderInlineCardDOM();
        renderMainModalDOM();
        renderConfirmLevelModalDOM();
        renderConfirmSupportModalDOM();
        updateEscalationUI();

        try {
            if (!state.syncChannel && typeof BroadcastChannel !== "undefined") {
                state.syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
            }
        } catch (eBc) { }

        var id = getTicketOrderId();
        if (id && id !== state.orderId) {
            loadTicketEscalationData(id);
        }

        if (typeof Spl !== "undefined" && Spl.EventBus && Spl.EventBus.register && !window.__pttEscBusRegistered) {
            window.__pttEscBusRegistered = true;
            Spl.EventBus.register("orderid", "value-change", function () {
                setTimeout(function () {
                    var newId = getTicketOrderId();
                    if (newId && newId !== state.orderId) {
                        loadTicketEscalationData(newId);
                    }
                }, 200);
            });
        }
    }

    if (typeof U !== "undefined" && typeof U.ready === "function") {
        U.ready(function () {
            initPttEscalationPanel();
            setTimeout(initPttEscalationPanel, 600);
            setTimeout(initPttEscalationPanel, 1500);
        });
    } else if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
            initPttEscalationPanel();
            setTimeout(initPttEscalationPanel, 600);
            setTimeout(initPttEscalationPanel, 1500);
        });
    } else {
        initPttEscalationPanel();
        setTimeout(initPttEscalationPanel, 600);
        setTimeout(initPttEscalationPanel, 1500);
    }
})();

