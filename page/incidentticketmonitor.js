/**
 * Incident Ticket Monitor - Work Order Watchlist Component
 * Pure JavaScript with OWS MessageProcessor Services integration
 * Theme: Shadcn/UI Dark (Zinc)
 * Prefix: incwo
 */

(function () {
    "use strict";

    // Service Endpoints (Module: IncidentTicketMonitor, Prefix: incwo)
    var SERVICE_LIST =
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_query_tt_info_get_list";
    var SERVICE_PIC_LIST =
        "/adc-service/rest/v1/services/datahub/cmdb/cmdb_contractor_getList";
    var SERVICE_DETAIL =
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_query_tt_detail";
    var SERVICE_CREATE =
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_create_tt_info";
    var SERVICE_UPDATE =
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_update_tt_info";
    var SERVICE_DELETE =
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_update";
    var SERVICE_RUNNING_TT =
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_query_link_down_tt_list";

    // Persistence helper for Active Filter (restored on refresh)
    var SAVED_FILTER_KEY = "incwo_active_filter";
    function getSavedFilter() {
        try {
            var saved = localStorage.getItem(SAVED_FILTER_KEY);
            if (saved && (saved === "ALL" || saved === "FWA" || saved === "FTTH" || saved === "PMA" || saved === "NEED_SUPPORT" || saved === "PROLONG_ONLY" || saved === "OVERDUE_FWA" || saved === "OVERDUE_FTTH" || saved === "OVERDUE_PMA" || saved === "OVERDUE_ALL")) {
                return saved;
            }
        } catch (e) { }
        return "ALL";
    }

    // State Management
    var state = {
        currentFilter: getSavedFilter(), // "ALL" | "FWA" | "FTTH" | "PMA" | "NEED_SUPPORT" | "PROLONG_ONLY" | "OVERDUE_FWA" | "OVERDUE_FTTH" | "OVERDUE_PMA" | "OVERDUE_ALL"
        tickets: [],
        fwaNum: 0,
        ftthNum: 0,
        pmaNum: 0,
        loading: false,
        picList: [],
        runningTickets: [],
        linkSegmentList: [],
        pendingDeleteId: null,
        pendingEscalationLevel: null,
        currentDetail: null,
        selectedSegments: [],
        segmentFilterQuery: "",
        lastUpdatedTime: "-",
        currentUser: "",
        autoRefreshTimer: null,
        clockTimer: null,
        toastTimer: null,
        modalMouseDownTarget: null,
        activeLogOrderId: null,
        activeLogList: [],
        syncChannel: null,
        initialModalSnapshot: null,
        modalOpenedAt: 0,
        modalForceSeq: 0,
        activeLockedOrderId: null,
        lockHeartbeatTimer: null,
        pendingConflictOverwriteFn: null,
    };

    // Cross-Laptop (DB) & Cross-Tab Priority Lock Constants (Process TT <-> Incident Ticket Monitor)
    var SYNC_CHANNEL_NAME = "ows_inc_ticket_sync_v1";
    var SYNC_STORAGE_KEY = "ows_inc_ticket_sync_event_v1";
    var LOCK_KEY_PREFIX = "ows_inc_ticket_lock_v1_";
    var LOCAL_LOCK_TTL_MS = 10 * 60 * 1000;
    var DB_LOCK_TTL_MS = 25000; // DB lock valid up to 25 seconds unless refreshed by session
    var HEARTBEAT_INTERVAL_MS = 10000; // Check DB takeover every 10 seconds (GET only, no repeated UPDATE)
    var SERVICE_LOCK_GET = "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_get";
    var MONITOR_TAB_ID = "mon_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);

    function getTicketLockKey(orderId) {
        return LOCK_KEY_PREFIX + String(orderId || "").trim().toUpperCase();
    }

    function parseTicketLockString(rawStr, ttlMs) {
        if (!rawStr || typeof rawStr !== "string") return null;
        var trimmed = rawStr.trim();
        if (trimmed.indexOf("{") !== 0) return null;
        try {
            var lock = JSON.parse(trimmed);
            if (!lock || !lock.holder || !lock.heartbeatAt) return null;
            if (Date.now() - Number(lock.heartbeatAt) > (ttlMs || DB_LOCK_TTL_MS)) {
                return null;
            }
            return lock;
        } catch (e) {
            return null;
        }
    }

    function readActiveTicketLock(orderId) {
        var normId = String(orderId || "").trim().toUpperCase();
        if (!normId) return null;
        try {
            var raw = localStorage.getItem(getTicketLockKey(normId));
            return parseTicketLockString(raw, LOCAL_LOCK_TTL_MS);
        } catch (e) {
            return null;
        }
    }

    function fetchDatabaseTicketLock(orderId, callback) {
        var normId = String(orderId || "").trim().toUpperCase();
        if (!normId || typeof MessageProcessor === "undefined" || !MessageProcessor.process) {
            if (callback) callback(null);
            return;
        }
        try {
            MessageProcessor.process({
                serviceId: SERVICE_LOCK_GET,
                data: { orderid: normId },
                success: function (res) {
                    var result = (res && res.result) ? res.result : null;
                    var rawLock = result ? extractOWSField(result.session_interface) : "";
                    var lock = parseTicketLockString(rawLock, DB_LOCK_TTL_MS);
                    if (callback) callback(lock);
                },
                error: function () {
                    if (callback) callback(null);
                }
            });
        } catch (e) {
            if (callback) callback(null);
        }
    }

    function formatLockHolderDisplay(lock) {
        if (!lock) return "another session";
        var where = "Incident Ticket Monitor";
        if (lock.holder === "PROCESS_TT") where = "Process TT";
        else if (lock.holder === "LINKDOWN_MONITOR") where = "Link Down Ticket Monitor";
        var who = lock.operator ? (" by " + lock.operator) : "";
        return where + who;
    }

    function writeMonitorTicketLock(orderId, openedAtTs, saveToDb) {
        var normId = String(orderId || "").trim().toUpperCase();
        if (!normId) return;
        var opName = state.currentUser || "";
        if (!opName) {
            try {
                if (typeof _runtime !== "undefined" && _runtime && _runtime.userName) opName = _runtime.userName;
                else if (window.currentUser) opName = window.currentUser;
            } catch (eU) { }
        }
        var lockObj = {
            orderid: normId,
            holder: "INCIDENT_MONITOR",
            tabId: MONITOR_TAB_ID,
            operator: String(opName || "Operator").trim(),
            openedAt: openedAtTs || state.modalOpenedAt || Date.now(),
            heartbeatAt: Date.now(),
            forceSeq: Number(state.modalForceSeq || 0)
        };
        var serialized = JSON.stringify(lockObj);
        try {
            localStorage.setItem(getTicketLockKey(normId), serialized);
            state.activeLockedOrderId = normId;
        } catch (e) { }

        if (saveToDb !== false && typeof MessageProcessor !== "undefined" && MessageProcessor.process) {
            try {
                MessageProcessor.process({
                    serviceId: SERVICE_DELETE,
                    data: { orderid: normId, session_interface: serialized },
                    success: function () { },
                    error: function () { }
                });
            } catch (eDb) { }
        }
    }

    function releaseMonitorTicketLock(skipDbClear) {
        var normId = state.activeLockedOrderId;
        if (normId) {
            var wasLocalOwner = false;
            try {
                var current = readActiveTicketLock(normId);
                if (current && current.tabId === MONITOR_TAB_ID) {
                    wasLocalOwner = true;
                    localStorage.removeItem(getTicketLockKey(normId));
                }
            } catch (e) { }
            if (skipDbClear !== true && wasLocalOwner && typeof MessageProcessor !== "undefined" && MessageProcessor.process) {
                try {
                    MessageProcessor.process({
                        serviceId: SERVICE_DELETE,
                        data: { orderid: normId, session_interface: "" },
                        success: function () { },
                        error: function () { }
                    });
                } catch (eDb) { }
            }
        }
        state.activeLockedOrderId = null;
        state.modalOpenedAt = 0;
        if (state.lockHeartbeatTimer) {
            clearInterval(state.lockHeartbeatTimer);
            state.lockHeartbeatTimer = null;
        }
    }

    function broadcastTicketSync(type, orderId, extra) {
        var normId = String(orderId || "").trim().toUpperCase();
        if (!normId) return;
        var payload = {
            type: type,
            orderid: normId,
            source: "INCIDENT_MONITOR",
            tabId: MONITOR_TAB_ID,
            operator: state.currentUser || "",
            openedAt: state.modalOpenedAt || Date.now(),
            forceSeq: state.modalForceSeq || 0,
            ts: Date.now()
        };
        if (extra && typeof extra === "object") {
            for (var k in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, k)) {
                    payload[k] = extra[k];
                }
            }
        }
        try {
            if (state.syncChannel) {
                state.syncChannel.postMessage(payload);
            }
        } catch (eBc) { }
        try {
            localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(payload));
        } catch (eLs) { }
    }

    // Safe OWS field extraction helper
    function extractOWSField(val) {
        if (val === null || val === undefined) return "";
        if (typeof val === "string") return val;
        if (typeof val === "number" || typeof val === "boolean") return String(val);
        if (Array.isArray(val) && val.length > 0) {
            var item = val[0];
            if (typeof item === "object" && item !== null) {
                return item.text || item.value || item.name || item.label || "";
            }
            return String(item);
        }
        if (typeof val === "object") {
            return (
                val.text ||
                val.value ||
                val.local ||
                val.utc ||
                val.name ||
                val.label ||
                ""
            );
        }
        return String(val);
    }

    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function getStatusClass(status) {
        if (!status) return "custom-status-other";
        var s = String(status).toLowerCase().trim();
        if (s === "running") {
            return "custom-status-running";
        }
        if (s === "complete" || s === "completed" || s === "success") {
            return "custom-status-complete";
        }
        if (
            s === "cancel" ||
            s === "canceled" ||
            s === "cancelled" ||
            s === "rejected" ||
            s === "failed" ||
            s === "fail"
        ) {
            return "custom-status-canceled";
        }
        return "custom-status-other";
    }

    // Escalation Level parsing and rendering helpers
    function parseEscalationLevel(rawVal, levelNum) {
        var lvl = 0;
        if (levelNum !== undefined && levelNum !== null && !isNaN(Number(levelNum))) {
            lvl = Number(levelNum);
        }

        var str = extractOWSField(rawVal);
        if (!str) {
            return { current_level: lvl, history: [] };
        }
        if (typeof str === "number") {
            return { current_level: str, history: [] };
        }
        if (typeof str === "object") {
            return {
                current_level: Number(str.current_level || lvl || 0),
                history: Array.isArray(str.history) ? str.history : []
            };
        }
        try {
            var parsed = JSON.parse(str);
            if (parsed && typeof parsed === "object") {
                return {
                    current_level: Number(parsed.current_level || lvl || 0),
                    history: Array.isArray(parsed.history) ? parsed.history : []
                };
            }
        } catch (e) {
            var num = parseInt(str, 10);
            if (!isNaN(num) && num >= 1 && num <= 5) {
                return { current_level: num, history: [] };
            }
        }
        return { current_level: lvl, history: [] };
    }

    // Helper ekstraksi total menit dari aging_time string (misal: "2 hours 15 minutes", "45 minutes")
    function parseAgingToMinutes(agingStr) {
        if (!agingStr || typeof agingStr !== "string") return 0;
        var total = 0;
        var hMatch = agingStr.match(/(\d+)\s*hour/i);
        if (hMatch && hMatch[1]) {
            total += parseInt(hMatch[1], 10) * 60;
        }
        var mMatch = agingStr.match(/(\d+)\s*minute/i);
        if (mMatch && mMatch[1]) {
            total += parseInt(mMatch[1], 10);
        }
        return total;
    }

    // Helper evaluasi level mana saja yang overdue/wajib berkedip berdasarkan aging menit
    function getEscalationBlinkMap(agingMinutes, currentLevel) {
        var aging = typeof agingMinutes === "number" ? agingMinutes : 0;
        var cur = typeof currentLevel === "number" ? currentLevel : 0;
        var blinkMap = {};

        // Semua level yang belum terisi (lvl > cur) tapi aging tiketnya sudah melampaui batas wajib kedip:
        // L1: aging > 30m
        // L2: aging > 90m
        // L3: aging > 170m
        // L4: aging > 230m
        // L5: aging > 470m
        if (cur < 1 && aging > 30) blinkMap[1] = true;
        if (cur < 2 && aging > 90) blinkMap[2] = true;
        if (cur < 3 && aging > 170) blinkMap[3] = true;
        if (cur < 4 && aging > 230) blinkMap[4] = true;
        if (cur < 5 && aging > 470) blinkMap[5] = true;

        return blinkMap;
    }

    // Helper mengecek apakah suatu tiket sedang berkedip (overdue escalation)
    function isTicketBlinking(t) {
        if (!t) return false;
        var orderId = extractOWSField(t.id || t.orderid || "").trim();
        var domain = extractOWSField(t.tt_domain || t.domain || "").toUpperCase();
        if (orderId.startsWith("PMA-") || t.ticket_type === "PMA" || domain === "PMA") {
            return false;
        }
        var rawAgingStr = extractOWSField(t.aging_time) || "";
        var agingMin = parseAgingToMinutes(rawAgingStr);
        if (agingMin === 0 && t.alarm_time) {
            try {
                var pAlarm = new Date(t.alarm_time.replace(/-/g, "/"));
                if (!isNaN(pAlarm.getTime())) {
                    var diff = Math.max(0, Date.now() - pAlarm.getTime());
                    agingMin = Math.floor(diff / (1000 * 60));
                }
            } catch (eAl) { }
        }
        var curLvl = Number(t.escalationlevelnumber || 0);
        var bMap = getEscalationBlinkMap(agingMin, curLvl);
        return Object.keys(bMap).some(function (k) { return bMap[k]; });
    }

    function renderEscalationDotsHTML(escData, orderId, agingMinutes) {
        var currentLevel = escData.current_level || 0;
        var hist = escData.history || [];
        var histMap = {};
        hist.forEach(function (h) {
            if (h && h.level) histMap[h.level] = h;
        });

        var aging = typeof agingMinutes === "number" ? agingMinutes : 0;
        var blinkMap = getEscalationBlinkMap(aging, currentLevel);
        var blinkingLevels = Object.keys(blinkMap).filter(function (k) { return blinkMap[k]; });

        var orderIdAttr = orderId ? escapeHtml(orderId) : "";
        var containerTitle = "Click to view escalation activity logs (Current: Level " + currentLevel + "/5)";
        if (blinkingLevels.length > 0) {
            containerTitle += " [WARNING: Aging " + aging + "m exceeds threshold for Level " + blinkingLevels.join(", ") + "! Please escalate]";
        }

        var html = '<div class="custom-escalation-container" title="' + escapeHtml(containerTitle) + '" onclick="window.openEscalationLogModal(\'' + orderIdAttr + '\')">';
        html += '  <div class="custom-escalation-group">';
        for (var lvl = 1; lvl <= 5; lvl++) {
            var isActive = lvl <= currentLevel;
            var isBlinking = !isActive && Boolean(blinkMap[lvl]);
            var dotClass = "custom-escalation-dot";
            if (isActive) {
                dotClass += " active-l" + lvl;
            } else if (isBlinking) {
                dotClass += " blink-alert-l" + lvl;
            }

            var tooltip = "Level " + lvl;
            if (isActive) {
                tooltip += " (Active)";
            } else if (isBlinking) {
                tooltip += " (Action Required! Aging " + aging + "m exceeds threshold)";
            } else {
                tooltip += " (Unreached)";
            }

            if (histMap[lvl]) {
                var h = histMap[lvl];
                tooltip += " - Triggered at " + formatTimeToUTC7(h.time) + " by " + (h.by || "operator");
            }
            html += '<span class="' + dotClass + '" title="' + escapeHtml(tooltip) + '">' + lvl + '</span>';
        }
        html += '  </div>';
        html += '  <span class="custom-escalation-label">Notif/Escalation Level</span>';
        html += '</div>';
        return html;
    }

    // Helper konversi/format waktu ke format standar WIB (YYYY-MM-DD HH:mm:ss)
    function formatTimeToUTC7(dateOrStr) {
        if (!dateOrStr) return "-";

        function padZero(num) {
            return num < 10 ? "0" + num : String(num);
        }

        if (dateOrStr instanceof Date) {
            var d = dateOrStr;
            if (isNaN(d.getTime())) return "-";
            return d.getFullYear() + "-" +
                padZero(d.getMonth() + 1) + "-" +
                padZero(d.getDate()) + " " +
                padZero(d.getHours()) + ":" +
                padZero(d.getMinutes()) + ":" +
                padZero(d.getSeconds());
        }

        if (typeof dateOrStr === "number") {
            var dNum = new Date(dateOrStr);
            if (isNaN(dNum.getTime())) return String(dateOrStr);
            return dNum.getFullYear() + "-" +
                padZero(dNum.getMonth() + 1) + "-" +
                padZero(dNum.getDate()) + " " +
                padZero(dNum.getHours()) + ":" +
                padZero(dNum.getMinutes()) + ":" +
                padZero(dNum.getSeconds());
        }

        if (typeof dateOrStr === "string") {
            var s = dateOrStr.trim();
            if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) {
                return s.replace("T", " ");
            }
            if (s.indexOf("Z") !== -1 || s.indexOf("+") !== -1) {
                var dIso = new Date(s);
                if (!isNaN(dIso.getTime())) {
                    return dIso.getFullYear() + "-" +
                        padZero(dIso.getMonth() + 1) + "-" +
                        padZero(dIso.getDate()) + " " +
                        padZero(dIso.getHours()) + ":" +
                        padZero(dIso.getMinutes()) + ":" +
                        padZero(dIso.getSeconds());
                }
            }
            return s;
        }

        return String(dateOrStr);
    }

    // Toast Notification
    function showToast(message, isSuccess) {
        var toast = document.getElementById("incwoToast");
        if (!toast) return;
        clearTimeout(state.toastTimer);
        toast.textContent = message;
        toast.className =
            "custom-toast show " + (isSuccess ? "toast-success" : "toast-error");
        state.toastTimer = setTimeout(function () {
            toast.className = "custom-toast";
        }, 3000);
    }

    // Live Clock & Last Updated
    function updateClock() {
        var clockElem = document.getElementById("incwoLiveClock");
        if (!clockElem) return;
        var now = new Date();
        clockElem.textContent =
            "Real-time Incident Ticket Monitoring & Work Order Management | " +
            now.toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
            }) +
            " " +
            now.toLocaleTimeString("en-GB", { hour12: false });
    }

    function updateLastRefreshed() {
        var now = new Date();
        state.lastUpdatedTime = now.toLocaleTimeString("en-GB", { hour12: false });
        var elem = document.getElementById("incwoLastUpdated");
        if (elem) elem.textContent = "Last update: " + state.lastUpdatedTime;
    }

    // Setup Dynamic DOM Controls
    function setupHeaderControls() {
        var placeholder = document.getElementById("incwoHeaderControlsPlaceholder");
        if (!placeholder) return;
        placeholder.className = "custom-header-controls";
        placeholder.innerHTML = "";

        var metricsDiv = document.createElement("div");
        metricsDiv.className = "custom-domain-metrics";

        var fwaBadge = document.createElement("div");
        fwaBadge.id = "incwoBadgeFwa";
        fwaBadge.className = "custom-domain-stat-badge fwa";
        fwaBadge.title = "Filter FWA tickets";
        fwaBadge.innerHTML =
            '<span class="custom-domain-stat-label">FWA</span>' +
            '<span class="custom-domain-stat-value" id="incwoStatFwa">' + (state.fwaNum || 0) + '</span>';
        fwaBadge.onclick = function () {
            if (fwaBadge.classList.contains("blink-alert")) {
                if (state.currentFilter === "OVERDUE_FWA") {
                    window.filterByDomain("FWA");
                } else {
                    window.filterByDomain("OVERDUE_FWA");
                }
            } else {
                window.filterByDomain("FWA");
            }
        };

        var ftthBadge = document.createElement("div");
        ftthBadge.id = "incwoBadgeFtth";
        ftthBadge.className = "custom-domain-stat-badge ftth";
        ftthBadge.title = "Filter FTTH tickets";
        ftthBadge.innerHTML =
            '<span class="custom-domain-stat-label">FTTH</span>' +
            '<span class="custom-domain-stat-value" id="incwoStatFtth">' + (state.ftthNum || 0) + '</span>';
        ftthBadge.onclick = function () {
            if (ftthBadge.classList.contains("blink-alert")) {
                if (state.currentFilter === "OVERDUE_FTTH") {
                    window.filterByDomain("FTTH");
                } else {
                    window.filterByDomain("OVERDUE_FTTH");
                }
            } else {
                window.filterByDomain("FTTH");
            }
        };

        var pmaBadge = document.createElement("div");
        pmaBadge.id = "incwoBadgePma";
        pmaBadge.className = "custom-domain-stat-badge pma";
        pmaBadge.title = "Filter PMA tickets";
        pmaBadge.innerHTML =
            '<span class="custom-domain-stat-label">PMA</span>' +
            '<span class="custom-domain-stat-value" id="incwoStatPma">' + (state.pmaNum || 0) + '</span>';
        pmaBadge.onclick = function () {
            window.filterByDomain("PMA");
        };

        metricsDiv.appendChild(fwaBadge);
        metricsDiv.appendChild(ftthBadge);
        metricsDiv.appendChild(pmaBadge);

        var lastUpdated = document.createElement("span");
        lastUpdated.id = "incwoLastUpdated";
        lastUpdated.className = "custom-last-updated";
        placeholder.appendChild(metricsDiv);
        placeholder.appendChild(lastUpdated);
    }

    function setupFilterSwitcher() {
        var container = document.getElementById("incwoFilterSwitcherPlaceholder");
        if (!container) return;
        container.className = "custom-filter-switcher";
        container.innerHTML = "";

        var needSupportCount = 0;
        var prolongCount = 0;
        if (Array.isArray(state.tickets)) {
            state.tickets.forEach(function (t) {
                var suppStatus = String(extractOWSField(t.escalationsupport) || "NO_NEED").toUpperCase();
                if (suppStatus === "NEED" || suppStatus === "NEED SUPPORT") {
                    needSupportCount++;
                }
                var prol = extractOWSField(t.prolong_reason);
                if (prol && prol !== "-" && prol !== "null" && prol !== "undefined" && prol.trim().length > 0) {
                    prolongCount++;
                }
            });
        }

        var filters = [
            { key: "ALL", label: "All" },
            { key: "FWA", label: "FWA" },
            { key: "FTTH", label: "FTTH" },
            { key: "PMA", label: "PMA" },
            { key: "NEED_SUPPORT", label: "Need Support", isSpecial: true, count: needSupportCount, type: "support" },
            { key: "PROLONG_ONLY", label: "Prolong Only", isSpecial: true, count: prolongCount, type: "prolong" }
        ];

        filters.forEach(function (f) {
            var btn = document.createElement("button");
            btn.type = "button";
            var baseClass = "custom-switch-btn";
            if (f.isSpecial) {
                baseClass += (f.type === "prolong" ? " btn-filter-prolong" : " btn-filter-support");
            }
            var isBtnActive = state.currentFilter === f.key ||
                (f.key === "FWA" && state.currentFilter === "OVERDUE_FWA") ||
                (f.key === "FTTH" && state.currentFilter === "OVERDUE_FTTH") ||
                (f.key === "PMA" && state.currentFilter === "OVERDUE_PMA");
            if (isBtnActive) baseClass += " active";
            btn.className = baseClass;

            if (f.isSpecial) {
                var dotClass = f.type === "prolong" ? "prolong-dot" : "support-dot";
                btn.innerHTML =
                    '<span class="' + dotClass + '"></span>' +
                    '<span>' + f.label + '</span>' +
                    (f.count > 0 ? ' <span style="font-size: 11px; opacity: 0.85; padding: 0 4px; border-radius: 3px; background: rgba(0,0,0,0.3);">(' + f.count + ')</span>' : '');
            } else {
                btn.textContent = f.label;
            }

            btn.onclick = function () {
                window.filterByDomain(f.key);
            };
            container.appendChild(btn);
        });
    }

    function setupWorkOrderControls() {
        var addBtnContainer = document.getElementById("incwoWoAddBtnContainer");
        if (addBtnContainer && !addBtnContainer.querySelector(".custom-btn-add-wo")) {
            var addBtn = document.createElement("button");
            addBtn.type = "button";
            addBtn.id = "incwoBtnAddWo";
            addBtn.className = "custom-btn-add-wo";
            addBtn.title = "Add Work Order";
            addBtn.setAttribute("aria-label", "Add Work Order");
            addBtn.innerHTML = "<span>+</span>";
            addBtn.onclick = function () {
                window.openAddModal();
            };
            addBtnContainer.innerHTML = "";
            addBtnContainer.appendChild(addBtn);
        }
    }

    // Inject Add Work Order Modal DOM Dynamically
    function renderAddModalDOM() {
        var placeholder = document.getElementById("incwoAddModalPlaceholder");
        if (!placeholder || placeholder.dataset.rendered === "true") return;
        placeholder.dataset.rendered = "true";

        var html =
            '<div class="custom-modal-overlay" id="incwoAddModal" style="display: none;" onmousedown="window.recordModalMouseDown(event)" onclick="window.closeAddModalOnBackdrop(event)">' +
            '  <div class="custom-modal-dialog">' +
            '    <div class="custom-modal-header">' +
            '      <span class="custom-modal-title">Add Work Order</span>' +
            '      <button type="button" class="custom-modal-close-btn" onclick="window.closeAddModal()">&#10005;</button>' +
            '    </div>' +
            '    <form id="incwoAddForm" onsubmit="window.submitAddTicket(event)">' +
            '      <div class="custom-modal-body">' +
            '        <div class="custom-modal-field">' +
            '          <label class="custom-modal-label">Domain / Type</label>' +
            '          <select class="custom-form-select" id="incwoAddDomain" onchange="window.onAddDomainChange()" required>' +
            '            <option value="FWA">FWA</option>' +
            '            <option value="FTTH">FTTH</option>' +
            '            <option value="PMA">PMA (Problem Management Activity)</option>' +
            '          </select>' +
            '        </div>' +
            '        <div class="custom-modal-field">' +
            '          <label class="custom-modal-label">TT Number / Order ID</label>' +
            '          <div class="custom-autocomplete-wrapper">' +
            '            <input type="text" class="custom-form-input" id="incwoAddTicketId" placeholder="Type or select running TT..." autocomplete="off" oninput="window.onAddTicketInput(event)" onfocus="window.onAddTicketFocus(event)" required />' +
            '            <div class="custom-autocomplete-dropdown" id="incwoAddTicketDropdown" style="display: none;"></div>' +
            '          </div>' +
            '        </div>' +
            '      </div>' +
            '      <div class="custom-modal-footer">' +
            '        <button type="button" class="custom-btn-cancel" onclick="window.closeAddModal()">Cancel</button>' +
            '        <button type="submit" class="custom-btn-submit" id="incwoAddSubmitBtn">Confirm</button>' +
            '      </div>' +
            '    </form>' +
            '  </div>' +
            '</div>';

        placeholder.innerHTML = html;
    }

    // Inject Detail / Edit Modal DOM Dynamically
    function renderDetailModalDOM() {
        var placeholder = document.getElementById("incwoDetailModalPlaceholder");
        if (!placeholder || placeholder.dataset.rendered === "true") return;
        placeholder.dataset.rendered = "true";

        var html =
            '<div class="custom-modal-overlay" id="incwoDetailModal" style="display: none;" onmousedown="window.recordModalMouseDown(event)" onclick="window.closeDetailModalOnBackdrop(event)">' +
            '  <div class="custom-modal-dialog custom-modal-dialog-large">' +
            '    <div class="custom-modal-header">' +
            '      <div class="custom-detail-title-group">' +
            '        <span class="custom-modal-title">Work Order Detail</span>' +
            '        <span class="custom-detail-id" id="incwoDetailHeaderOrderId">-</span>' +
            '      </div>' +
            '      <button type="button" class="custom-modal-close-btn" onclick="window.closeDetailModal()">&#10005;</button>' +
            '    </div>' +
            '    <form id="incwoDetailForm" class="custom-detail-form" onsubmit="window.saveDetail(event)">' +
            '      <div class="custom-modal-body custom-modal-scrollable">' +
            '        <div class="custom-modal-field">' +
            '          <label class="custom-modal-label">PIC Assign (Responsibility)</label>' +
            '          <select class="custom-form-select" id="incwoDetailPic">' +
            '            <option value="">-- No PIC Assigned --</option>' +
            '          </select>' +
            '        </div>' +
            '        <div id="incwoIncEscalationSection" class="custom-modal-escalation-section" style="display: none;">' +
            '          <div class="custom-modal-escalation-header" onclick="window.toggleEscalationCollapse()">' +
            '            <div class="custom-escalation-title-group">' +
            '              <svg id="incwoEscalationCollapseIcon" class="custom-collapse-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
            '              <label class="custom-modal-label" style="margin: 0; cursor: pointer;">Escalation Level & Support</label>' +
            '              <span id="incwoEscalationSummaryBadge" class="custom-escalation-summary-badge">Level 0</span>' +
            '            </div>' +
            '            <div class="custom-escalation-header-actions" onclick="event.stopPropagation()">' +
            '              <button type="button" class="custom-support-btn support-no-need" id="incwoDetailSupportBtn" onclick="window.toggleSupportStatus()">' +
            '                <span id="incwoDetailSupportText">No Need Support</span>' +
            '              </button>' +
            '            </div>' +
            '          </div>' +
            '          <div id="incwoEscalationCollapseBody" class="custom-escalation-collapse-body" style="display: none;">' +
            '            <div class="custom-modal-escalation-steps">' +
            '              <button type="button" class="custom-modal-step-btn" id="incwoStepBtn1" onclick="window.setEscalationLevel(1)">' +
            '                <span class="step-indicator"></span>' +
            '                <span>Level 1</span>' +
            '              </button>' +
            '              <button type="button" class="custom-modal-step-btn" id="incwoStepBtn2" onclick="window.setEscalationLevel(2)">' +
            '                <span class="step-indicator"></span>' +
            '                <span>Level 2</span>' +
            '              </button>' +
            '              <button type="button" class="custom-modal-step-btn" id="incwoStepBtn3" onclick="window.setEscalationLevel(3)">' +
            '                <span class="step-indicator"></span>' +
            '                <span>Level 3</span>' +
            '              </button>' +
            '              <button type="button" class="custom-modal-step-btn" id="incwoStepBtn4" onclick="window.setEscalationLevel(4)">' +
            '                <span class="step-indicator"></span>' +
            '                <span>Level 4</span>' +
            '              </button>' +
            '              <button type="button" class="custom-modal-step-btn" id="incwoStepBtn5" onclick="window.setEscalationLevel(5)">' +
            '                <span class="step-indicator"></span>' +
            '                <span>Level 5</span>' +
            '              </button>' +
            '            </div>' +
            '            <div class="custom-modal-escalation-history" id="incwoEscalationHistoryLog">' +
            '              <span>No escalation history recorded.</span>' +
            '            </div>' +
            '          </div>' +
            '        </div>' +
            '        <div id="incwoPmaExtraFields" class="custom-pma-extra-fields" style="display: none;">' +
            '          <div class="custom-pma-plain-row">' +
            '            <span class="custom-pma-plain-label">Activity Summary</span>' +
            '            <span class="custom-pma-plain-sep">:</span>' +
            '            <span class="custom-pma-plain-val" id="incwoDetailActivitySummary">-</span>' +
            '          </div>' +
            '          <div class="custom-pma-plain-row">' +
            '            <span class="custom-pma-plain-label">Activity List</span>' +
            '            <span class="custom-pma-plain-sep">:</span>' +
            '            <span class="custom-pma-plain-val" id="incwoDetailNocActivityNotes">-</span>' +
            '          </div>' +
            '        </div>' +
            '        <div class="custom-modal-field custom-modal-field-grow">' +
            '          <label class="custom-modal-label">Action</label>' +
            '          <textarea class="custom-form-textarea custom-textarea-action" id="incwoDetailAction" rows="18" placeholder="Enter action / chronology updates..."></textarea>' +
            '        </div>' +
            '      </div>' +
            '      <div class="custom-modal-footer">' +
            '        <button type="button" class="custom-btn-cancel" onclick="window.closeDetailModal()">Cancel</button>' +
            '        <button type="submit" class="custom-btn-submit" id="incwoSaveDetailBtn">Save Changes</button>' +
            '      </div>' +
            '    </form>' +
            '  </div>' +
            '</div>';

        placeholder.innerHTML = html;
    }

    // Inject Delete Confirmation Modal DOM Dynamically
    function renderDeleteModalDOM() {
        var placeholder = document.getElementById("incwoDeleteModalPlaceholder");
        if (!placeholder || placeholder.dataset.rendered === "true") return;
        placeholder.dataset.rendered = "true";

        var html =
            '<div class="custom-modal-overlay" id="incwoDeleteModal" style="display: none;" onmousedown="window.recordModalMouseDown(event)" onclick="window.closeDeleteModalOnBackdrop(event)">' +
            '  <div class="custom-modal-dialog custom-modal-dialog-sm">' +
            '    <div class="custom-modal-header">' +
            '      <span class="custom-modal-title">Delete Work Order</span>' +
            '      <button type="button" class="custom-modal-close-btn" onclick="window.closeDeleteModal()">&#10005;</button>' +
            '    </div>' +
            '    <div class="custom-modal-body custom-confirm-body">' +
            '      <div class="custom-confirm-icon">' +
            '        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>' +
            '      </div>' +
            '      <div class="custom-confirm-message">' +
            '        Are you sure you want to delete <strong id="incwoPendingDeleteId" class="custom-ticket-id">-</strong>?' +
            '      </div>' +
            '    </div>' +
            '    <div class="custom-modal-footer">' +
            '      <button type="button" class="custom-btn-cancel" onclick="window.closeDeleteModal()">Cancel</button>' +
            '      <button type="button" class="custom-btn-submit custom-btn-danger" id="incwoConfirmDeleteBtn" onclick="window.confirmDeleteTicket()">Delete</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';

        placeholder.innerHTML = html;
    }

    // Inject Escalation Confirmation Modal DOM Dynamically
    function renderEscalationModalDOM() {
        var placeholder = document.getElementById("incwoEscalationModalPlaceholder");
        if (!placeholder || placeholder.dataset.rendered === "true") return;
        placeholder.dataset.rendered = "true";

        var html =
            '<div class="custom-modal-overlay" id="incwoEscalationModal" style="display: none; z-index: 10005;" onmousedown="window.recordModalMouseDown(event)" onclick="window.closeEscalationConfirmModalOnBackdrop(event)">' +
            '  <div class="custom-modal-dialog custom-modal-dialog-md">' +
            '    <div class="custom-modal-header">' +
            '      <span class="custom-modal-title">Confirm Escalation</span>' +
            '      <button type="button" class="custom-modal-close-btn" onclick="window.closeEscalationConfirmModal()">&#10005;</button>' +
            '    </div>' +
            '    <div class="custom-modal-body custom-confirm-body" style="text-align: left;">' +
            '      <div style="display: flex; gap: 14px; align-items: flex-start; margin-bottom: 14px;">' +
            '        <div class="custom-confirm-icon" style="background-color: rgba(2, 132, 199, 0.15); color: #38bdf8; flex-shrink: 0;">' +
            '          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>' +
            '        </div>' +
            '        <div class="custom-confirm-message" style="margin: 0;">' +
            '          Are you sure you want to escalate this ticket to <strong id="incwoPendingEscalationTargetText" style="color: #38bdf8;">Level -</strong>?<br>' +
            '          <span style="font-size: 12px; color: #a1a1aa; margin-top: 2px; display: block;">This action will be permanently recorded into the escalation log.</span>' +
            '        </div>' +
            '      </div>' +
            '      <div class="custom-modal-field" style="width: 100%;">' +
            '        <label class="custom-modal-label" style="font-size: 12px;">Reason / Description <span style="color: #ef4444;">*</span></label>' +
            '        <textarea class="custom-form-textarea" id="incwoEscalationReasonInput" rows="5" placeholder="Enter reason / description for escalating this level (mandatory)..."></textarea>' +
            '      </div>' +
            '    </div>' +
            '    <div class="custom-modal-footer">' +
            '      <button type="button" class="custom-btn-cancel" onclick="window.closeEscalationConfirmModal()">Cancel</button>' +
            '      <button type="button" class="custom-btn-submit" id="incwoConfirmEscalateBtn" onclick="window.executeConfirmedEscalation()">Confirm</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';

        placeholder.innerHTML = html;
    }

    // Inject Support Confirmation Modal DOM Dynamically
    function renderSupportModalDOM() {
        var placeholder = document.getElementById("incwoSupportModalPlaceholder");
        if (!placeholder || placeholder.dataset.rendered === "true") return;
        placeholder.dataset.rendered = "true";

        var html =
            '<div class="custom-modal-overlay" id="incwoSupportModal" style="display: none; z-index: 10005;" onmousedown="window.recordModalMouseDown(event)" onclick="window.closeSupportConfirmModalOnBackdrop(event)">' +
            '  <div class="custom-modal-dialog custom-modal-dialog-md">' +
            '    <div class="custom-modal-header">' +
            '      <span class="custom-modal-title" id="incwoSupportModalTitle">Change Support Status</span>' +
            '      <button type="button" class="custom-modal-close-btn" onclick="window.closeSupportConfirmModal()">&#10005;</button>' +
            '    </div>' +
            '    <div class="custom-modal-body custom-confirm-body" style="text-align: left;">' +
            '      <div style="display: flex; gap: 14px; align-items: flex-start; margin-bottom: 14px;">' +
            '        <div class="custom-confirm-icon" id="incwoSupportModalIcon" style="background-color: rgba(239, 68, 68, 0.15); color: #f87171; flex-shrink: 0;">' +
            '          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
            '        </div>' +
            '        <div class="custom-confirm-message" style="margin: 0;">' +
            '          Change support requirement to <strong id="incwoPendingSupportTargetText" style="color: #f87171;">Need Support</strong>?<br>' +
            '          <span style="font-size: 12px; color: #a1a1aa; margin-top: 2px; display: block;">This will be logged into escalation history.</span>' +
            '        </div>' +
            '      </div>' +
            '      <div class="custom-modal-field" style="width: 100%;">' +
            '        <label class="custom-modal-label" style="font-size: 12px;">Support Reason / Description <span style="color: #ef4444;">*</span></label>' +
            '        <textarea class="custom-form-textarea" id="incwoSupportReasonInput" rows="5" placeholder="Enter reason / description for support request (mandatory)..."></textarea>' +
            '      </div>' +
            '    </div>' +
            '    <div class="custom-modal-footer">' +
            '      <button type="button" class="custom-btn-cancel" onclick="window.closeSupportConfirmModal()">Cancel</button>' +
            '      <button type="button" class="custom-btn-submit" id="incwoConfirmSupportBtn" onclick="window.executeConfirmedSupport()">Confirm</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';

        placeholder.innerHTML = html;
    }

    // Inject Activity Logs Popup Modal DOM Dynamically
    function renderLogModalDOM() {
        var placeholder = document.getElementById("incwoLogModalPlaceholder");
        if (!placeholder || placeholder.dataset.rendered === "true") return;
        placeholder.dataset.rendered = "true";

        var html =
            '<div class="custom-modal-overlay" id="incwoLogModal" style="display: none; z-index: 10005;" onmousedown="window.recordModalMouseDown(event)" onclick="window.closeEscalationLogModalOnBackdrop(event)">' +
            '  <div class="custom-modal-dialog custom-activity-log-dialog">' +
            '    <div class="custom-modal-header">' +
            '      <span class="custom-modal-title" id="incwoLogModalTitle">ESCALATION LOGS</span>' +
            '      <button type="button" class="custom-modal-close-btn" onclick="window.closeEscalationLogModal()">&#10005;</button>' +
            '    </div>' +
            '    <div class="custom-activity-log-body" id="incwoLogModalBody">' +
            '      <div style="color: #a1a1aa; font-size: 13px; text-align: center; padding: 20px 0;">Loading escalation logs...</div>' +
            '    </div>' +
            '    <div class="custom-modal-footer" style="padding: 10px 16px; border-top: 1px solid rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; align-items: center;">' +
            '      <button type="button" class="custom-btn-copy-log" id="incwoBtnCopyLog" onclick="window.copyEscalationLogFormatted()">' +
            '        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
            '        <span>Copy Logs</span>' +
            '      </button>' +
            '      <button type="button" class="custom-btn-cancel" onclick="window.closeEscalationLogModal()">Close</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';

        placeholder.innerHTML = html;
    }

    // Inject Conflict Protection Modal DOM Dynamically (Process TT <-> Incident Monitor Guard)
    function renderConflictModalDOM() {
        if (document.getElementById("incwoConflictModal")) return;
        var existingPlaceholder = document.getElementById("incwoConflictModalPlaceholder");
        var refPlaceholder = document.getElementById("incwoDeleteModalPlaceholder") || document.getElementById("incwoDetailModalPlaceholder") || document.getElementById("incwoWorkOrderLayout");
        var wrapper = existingPlaceholder || ((refPlaceholder && refPlaceholder.parentNode) ? refPlaceholder.parentNode : (document.querySelector(".custom-dashboard-wrapper") || document.body));

        var container = existingPlaceholder || document.createElement("div");
        if (!existingPlaceholder) {
            container.id = "incwoConflictModalPlaceholder";
        }

        container.innerHTML =
            '<div class="custom-modal-overlay" id="incwoConflictModal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100vw; height: 100vh; background: rgba(9, 9, 11, 0.82); backdrop-filter: blur(4px); z-index: 2147483647; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">' +
            '  <div class="custom-modal-dialog custom-modal-dialog-sm" style="background: #18181b; border: 1px solid #ef4444; border-radius: 12px; width: 100%; max-width: 440px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.65); overflow: hidden; color: #fafafa;">' +
            '    <div class="custom-modal-header" style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #27272a; background: #18181b;">' +
            '      <span class="custom-modal-title" style="color: #f87171; font-size: 15px; font-weight: 700;">Conflict Protection Alert</span>' +
            '      <button type="button" class="custom-modal-close-btn" onclick="window.closeConflictModal()" style="background: transparent; border: none; color: #a1a1aa; font-size: 16px; cursor: pointer; padding: 4px 8px; line-height: 1;">&#10005;</button>' +
            '    </div>' +
            '    <div class="custom-modal-body custom-confirm-body" style="padding: 22px 20px; text-align: center; display: flex; flex-direction: column; align-items: center;">' +
            '      <div class="custom-confirm-icon" style="width: 48px; height: 48px; border-radius: 50%; background-color: rgba(239, 68, 68, 0.15); color: #f87171; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto;">' +
            '        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
            '      </div>' +
            '      <div style="margin-bottom: 10px;"><strong id="incwoConflictTicketId" class="custom-ticket-id" style="color: #38bdf8; background: rgba(56, 189, 248, 0.12); padding: 3px 10px; border-radius: 6px; font-size: 13px; font-weight: 600; display: inline-block;">-</strong></div>' +
            '      <div class="custom-confirm-message" id="incwoConflictMessageText" style="line-height: 1.55; font-size: 13px; color: #d4d4d8; margin: 0;">' +
            '        This ticket is currently open in Process TT. Please close the Process TT page first to avoid data conflicts, then continue.' +
            '      </div>' +
            '    </div>' +
            '    <div class="custom-modal-footer" style="display: flex; gap: 10px; padding: 14px 18px; border-top: 1px solid #27272a; background: #141417;">' +
            '      <button type="button" class="custom-btn-cancel" style="flex: 1; padding: 10px 14px; border: 1px solid #3f3f46; border-radius: 8px; background: #27272a; color: #e4e4e7; font-size: 13px; font-weight: 600; cursor: pointer;" onclick="window.closeConflictModal()">Cancel</button>' +
            '      <button type="button" class="custom-btn-submit custom-btn-danger" id="incwoConflictProceedBtn" style="flex: 1.5; padding: 10px 14px; border: none; border-radius: 8px; background: #ef4444; color: #ffffff; font-size: 13px; font-weight: 600; cursor: pointer;" onclick="window.confirmConflictOverwrite()">I have closed ticket page, Proceed</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';

        if (!existingPlaceholder) {
            wrapper.appendChild(container);
        }
    }

    function showConflictAlertModal(orderId, messageText, onOverwriteCallback) {
        renderConflictModalDOM();
        state.pendingConflictOverwriteFn = typeof onOverwriteCallback === "function" ? onOverwriteCallback : null;
        var modal = document.getElementById("incwoConflictModal");
        var idEl = document.getElementById("incwoConflictTicketId");
        var msgEl = document.getElementById("incwoConflictMessageText");
        var proceedBtn = document.getElementById("incwoConflictProceedBtn");
        if (proceedBtn) {
            proceedBtn.disabled = false;
            proceedBtn.textContent = "I have closed ticket page, Proceed";
        }
        if (idEl) idEl.textContent = orderId || "-";
        if (msgEl && messageText) msgEl.textContent = messageText;
        if (modal) modal.style.display = "flex";
    }

    window.closeConflictModal = function () {
        var modal = document.getElementById("incwoConflictModal");
        if (modal) modal.style.display = "none";
        state.pendingConflictOverwriteFn = null;
    };

    window.confirmConflictOverwrite = function () {
        var fn = state.pendingConflictOverwriteFn;
        if (typeof fn === "function") {
            fn();
        } else {
            window.closeConflictModal();
        }
    };

    function verifyAndProceedIfProcessTTClosed(orderId, onVerifiedSuccess) {
        var normId = String(orderId || "").trim().toUpperCase();
        var proceedBtn = document.getElementById("incwoConflictProceedBtn");
        if (proceedBtn) {
            proceedBtn.disabled = true;
            proceedBtn.textContent = "Verifying Process TT...";
        }

        var isStillAliveInBrowser = false;
        var aliveHandler = function (evt) {
            var payload = null;
            if (evt && evt.data) {
                payload = evt.data;
            } else if (evt && evt.key === SYNC_STORAGE_KEY && evt.newValue) {
                try { payload = JSON.parse(evt.newValue); } catch (e) { }
            }
            if (payload && payload.type === "PROCESS_TT_IS_ALIVE") {
                var pId = String(payload.orderid || "").trim().toUpperCase();
                if (pId === normId) {
                    isStillAliveInBrowser = true;
                }
            }
        };

        // Listen for live alive response on BroadcastChannel & storage
        if (state.syncChannel) {
            try { state.syncChannel.addEventListener("message", aliveHandler); } catch (eBc) { }
        }
        window.addEventListener("storage", aliveHandler);

        // Ping all tabs: is Process TT still open for this ticket?
        broadcastTicketSync("CHECK_PROCESS_TT_ALIVE", normId);

        // Wait 350ms for live response from open Process TT tabs
        setTimeout(function () {
            if (state.syncChannel) {
                try { state.syncChannel.removeEventListener("message", aliveHandler); } catch (eBc2) { }
            }
            window.removeEventListener("storage", aliveHandler);

            if (isStillAliveInBrowser) {
                // Process TT is definitely still open in the browser!
                if (proceedBtn) {
                    proceedBtn.disabled = false;
                    proceedBtn.textContent = "I have closed ticket page, Proceed";
                }
                var msgEl = document.getElementById("incwoConflictMessageText");
                if (msgEl) {
                    msgEl.innerHTML = '<span style="color: #ef4444; font-weight: 700;">Process TT is still open!</span><br>The ticket page has not been closed yet. Please close the ticket tab in Process TT first before proceeding.';
                }
                showToast("Cannot proceed: Ticket is still open in Process TT! Please close it first.", false);
                return;
            }

            // Not alive in any browser tab! Now check DB for cross-laptop scenario
            var localLockBeforeClear = readActiveTicketLock(normId);
            fetchDatabaseTicketLock(normId, function (dbLock) {
                var isCrossLaptopAlive = false;
                if (dbLock && dbLock.tabId !== MONITOR_TAB_ID && dbLock.holder === "PROCESS_TT") {
                    var ageMs = Date.now() - Number(dbLock.heartbeatAt || 0);
                    var currentOp = state.currentUser || (typeof _runtime !== "undefined" && _runtime && _runtime.userName ? _runtime.userName : (window.currentUser || ""));
                    var isSameOperator = Boolean(
                        (localLockBeforeClear && localLockBeforeClear.tabId && dbLock.tabId && localLockBeforeClear.tabId === dbLock.tabId) ||
                        (dbLock.operator && String(dbLock.operator).trim().toLowerCase() === "operator") ||
                        (dbLock.operator && currentOp && String(dbLock.operator).trim().toLowerCase() === String(currentOp).trim().toLowerCase())
                    );
                    if (ageMs <= 25000 && !isSameOperator) {
                        isCrossLaptopAlive = true;
                    }
                }

                if (isCrossLaptopAlive) {
                    if (proceedBtn) {
                        proceedBtn.disabled = false;
                        proceedBtn.textContent = "I have closed ticket page, Proceed";
                    }
                    var msgElCross = document.getElementById("incwoConflictMessageText");
                    if (msgElCross) {
                        msgElCross.innerHTML = '<span style="color: #ef4444; font-weight: 700;">Ticket is being edited on another computer!</span><br>Operator <b>' + (dbLock.operator || 'Unknown') + '</b> currently has this ticket open in Process TT.';
                    }
                    showToast("Cannot proceed: Ticket is open in Process TT by " + (dbLock.operator || "another operator"), false);
                    return;
                }

                // Process TT is verified CLOSED! Clear any stale local lock and proceed
                try {
                    localStorage.removeItem(getTicketLockKey(normId));
                } catch (e) { }

                if (proceedBtn) {
                    proceedBtn.disabled = false;
                    proceedBtn.textContent = "I have closed ticket page, Proceed";
                }
                window.closeConflictModal();
                showToast("Process TT closed verified. Opening ticket details...", true);
                if (typeof onVerifiedSuccess === "function") {
                    onVerifiedSuccess();
                } else {
                    proceedOpenDetailModal(normId, true);
                }
            });
        }, 350);
    }

    function handleIncomingProcessTTSync(payload) {
        if (!payload || payload.tabId === MONITOR_TAB_ID) return;
        var incomingId = String(payload.orderid || "").trim().toUpperCase();
        if (!incomingId) return;

        var currentOpenId = "";
        if (state.currentDetail) {
            currentOpenId = String(extractOWSField(state.currentDetail.orderid || state.currentDetail.id) || "").trim().toUpperCase();
        }
        var detailModal = document.getElementById("incwoDetailModal");
        var isDetailModalOpen = detailModal && detailModal.style.display === "flex" && currentOpenId === incomingId;

        if ((payload.type === "PROCESS_TT_HAS_PRIORITY" || payload.type === "PROCESS_TT_FORCE_OVERWRITE") && isDetailModalOpen) {
            if (payload.forceSeq) {
                state.modalForceSeq = Number(payload.forceSeq);
            }
            // Do NOT clear DB session_interface because Process TT is now the rightful lock owner!
            releaseMonitorTicketLock(true);
            window.closeEscalationConfirmModal();
            window.closeSupportConfirmModal();
            window.closeDetailModal(true);
            var alertMsg = payload.type === "PROCESS_TT_FORCE_OVERWRITE"
                ? ("Ticket " + incomingId + " was taken over in Process TT. Please close the Process TT page first to avoid data conflicts, then proceed.")
                : ("Ticket " + incomingId + " is currently open in Process TT. Please close the Process TT page first to avoid data conflicts, then proceed.");
            showConflictAlertModal(
                incomingId,
                alertMsg,
                function () {
                    verifyAndProceedIfProcessTTClosed(incomingId, function () {
                        proceedOpenDetailModal(incomingId, true);
                    });
                }
            );
        } else if (payload.type === "PROCESS_TT_SAVED") {
            if (isDetailModalOpen) {
                releaseMonitorTicketLock(true);
                window.closeEscalationConfirmModal();
                window.closeSupportConfirmModal();
                window.closeDetailModal(true);
                showConflictAlertModal(
                    incomingId,
                    "Ticket " + incomingId + " was just saved in Process TT. Please close the Process TT page first, or proceed to reload and edit here.",
                    function () {
                        verifyAndProceedIfProcessTTClosed(incomingId, function () {
                            proceedOpenDetailModal(incomingId, true);
                        });
                    }
                );
            }
            setTimeout(function () {
                loadTicketList(true);
            }, 800);
        }
    }

    function initCrossTabTicketSync() {
        try {
            if (typeof BroadcastChannel !== "undefined") {
                state.syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
                state.syncChannel.onmessage = function (evt) {
                    if (evt && evt.data) {
                        handleIncomingProcessTTSync(evt.data);
                    }
                };
            }
        } catch (eBc) { }

        try {
            window.addEventListener("storage", function (evt) {
                if (evt && evt.key === SYNC_STORAGE_KEY && evt.newValue) {
                    try {
                        var parsed = JSON.parse(evt.newValue);
                        handleIncomingProcessTTSync(parsed);
                    } catch (eJson) { }
                }
            });
        } catch (eSt) { }

        window.addEventListener("beforeunload", releaseMonitorTicketLock);
        window.addEventListener("pagehide", releaseMonitorTicketLock);
        window.addEventListener("unload", releaseMonitorTicketLock);
    }

    function renderActionTimeline(actionVal) {
        var raw = extractOWSField(actionVal).trim();
        if (!raw || raw === "-" || raw === "null") {
            return '<div class="custom-detail-textblock">-</div>';
        }

        var lines = raw
            .split(/\r?\n/)
            .map(function (l) {
                return l.trim();
            })
            .filter(Boolean);

        if (lines.length === 0) {
            return '<div class="custom-detail-textblock">-</div>';
        }

        var html = '<div class="custom-timeline">';
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var timeMatch = line.match(
                /^((?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}:\d{2}(?::\d{2})?))\s*[-:]?\s*(.*)$/
            );
            var timeStr = "";
            var textStr = line;

            if (timeMatch) {
                timeStr = timeMatch[1].trim();
                textStr = (timeMatch[2] || "").trim();
            }

            var hasTime = Boolean(timeStr);
            var itemClass = "custom-timeline-item" + (hasTime ? " has-timestamp" : " no-timestamp");

            html += '<div class="' + itemClass + '">';
            html += '  <div class="custom-timeline-marker-col">';
            if (hasTime) {
                html += '    <div class="custom-timeline-marker"></div>';
            }
            html += '    <div class="custom-timeline-line"></div>';
            html += '  </div>';
            html += '  <div class="custom-timeline-content">';
            if (timeStr) {
                html += '    <span class="custom-timeline-time">' + escapeHtml(timeStr) + '</span>';
            }
            if (textStr) {
                html += '    <span class="custom-timeline-text">' + escapeHtml(textStr) + '</span>';
            }
            html += "  </div>";
            html += "</div>";
        }
        html += "</div>";
        return html;
    }

    function getFilteredTickets() {
        if (state.currentFilter === "ALL") {
            return state.tickets;
        }

        if (state.currentFilter === "NEED_SUPPORT") {
            return state.tickets.filter(function (t) {
                var suppStatus = String(extractOWSField(t.escalationsupport) || "NO_NEED").toUpperCase();
                return suppStatus === "NEED" || suppStatus === "NEED SUPPORT";
            });
        }

        if (state.currentFilter === "PROLONG_ONLY") {
            return state.tickets.filter(function (t) {
                var prol = extractOWSField(t.prolong_reason);
                return Boolean(prol && prol !== "-" && prol !== "null" && prol !== "undefined" && prol.trim().length > 0);
            });
        }

        if (state.currentFilter === "OVERDUE_FWA") {
            return state.tickets.filter(function (t) {
                var orderId = extractOWSField(t.id || t.orderid || "").trim();
                var domain = extractOWSField(t.tt_domain || t.domain || "").toUpperCase();
                var isPMA = orderId.startsWith("PMA-") || t.ticket_type === "PMA" || domain === "PMA";
                return !isPMA && domain.indexOf("FTTH") === -1 && isTicketBlinking(t);
            });
        }

        if (state.currentFilter === "OVERDUE_FTTH") {
            return state.tickets.filter(function (t) {
                var domain = extractOWSField(t.tt_domain || t.domain || "").toUpperCase();
                return domain.indexOf("FTTH") !== -1 && isTicketBlinking(t);
            });
        }

        if (state.currentFilter === "OVERDUE_PMA") {
            return state.tickets.filter(function (t) {
                var orderId = extractOWSField(t.id || t.orderid || "").trim();
                var domain = extractOWSField(t.tt_domain || t.domain || "").toUpperCase();
                return (orderId.startsWith("PMA-") || t.ticket_type === "PMA" || domain === "PMA") && isTicketBlinking(t);
            });
        }

        if (state.currentFilter === "OVERDUE_ALL") {
            return state.tickets.filter(function (t) {
                return isTicketBlinking(t);
            });
        }

        return state.tickets.filter(function (t) {
            var orderId = extractOWSField(t.id || t.orderid || "").trim();
            var domain = extractOWSField(t.tt_domain || t.domain || "").toUpperCase();
            var isPMA = orderId.startsWith("PMA-") || t.ticket_type === "PMA" || domain === "PMA";

            if (state.currentFilter === "PMA") {
                return isPMA;
            }
            if (isPMA) {
                return false;
            }
            if (state.currentFilter === "FTTH") {
                return domain.indexOf("FTTH") !== -1;
            }
            if (state.currentFilter === "FWA") {
                return domain.indexOf("FWA") !== -1 || domain.indexOf("FTTH") === -1;
            }
            return domain === state.currentFilter;
        });
    }

    function renderWorkOrderCards() {
        var container = document.getElementById("incwoTicketCardsContainer");
        var countElem = document.getElementById("incwoTicketWatchCount");
        var statFwa = document.getElementById("incwoStatFwa");
        var statFtth = document.getElementById("incwoStatFtth");
        var statPma = document.getElementById("incwoStatPma");

        if (statFwa) statFwa.textContent = state.fwaNum || 0;
        if (statFtth) statFtth.textContent = state.ftthNum || 0;
        if (statPma) statPma.textContent = state.pmaNum || 0;

        var fwaBlink = false;
        var ftthBlink = false;

        if (Array.isArray(state.tickets)) {
            state.tickets.forEach(function (t) {
                var orderId = extractOWSField(t.id || t.orderid || "").trim();
                var domain = extractOWSField(t.tt_domain || t.domain || "").toUpperCase();
                var isPMA = orderId.startsWith("PMA-") || t.ticket_type === "PMA" || domain === "PMA";
                if (isPMA) return;

                var isFtth = domain.indexOf("FTTH") !== -1;
                var rawAgingStr = extractOWSField(t.aging_time) || "";
                var agingMin = parseAgingToMinutes(rawAgingStr);
                if (agingMin === 0 && t.alarm_time) {
                    try {
                        var pAlarm = new Date(t.alarm_time.replace(/-/g, "/"));
                        if (!isNaN(pAlarm.getTime())) {
                            var diff = Math.max(0, Date.now() - pAlarm.getTime());
                            agingMin = Math.floor(diff / (1000 * 60));
                        }
                    } catch (eAl) { }
                }

                var curLvl = Number(t.escalationlevelnumber || 0);
                var bMap = getEscalationBlinkMap(agingMin, curLvl);
                var hasBlink = Object.keys(bMap).some(function (k) { return bMap[k]; });

                if (hasBlink) {
                    if (isFtth) {
                        ftthBlink = true;
                    } else {
                        fwaBlink = true;
                    }
                }
            });
        }

        var badgeFwa = document.getElementById("incwoBadgeFwa");
        var badgeFtth = document.getElementById("incwoBadgeFtth");
        var badgePma = document.getElementById("incwoBadgePma");

        if (badgeFwa) {
            badgeFwa.classList.toggle("blink-alert", fwaBlink);
            badgeFwa.classList.toggle("is-active-filter", state.currentFilter === "OVERDUE_FWA" || state.currentFilter === "FWA");
            if (fwaBlink) {
                badgeFwa.title = state.currentFilter === "OVERDUE_FWA"
                    ? "Filtered: FWA Overdue tickets only (Click again to show all FWA)"
                    : "FWA has overdue escalation tickets! (Click to show overdue only)";
            } else {
                badgeFwa.title = "Filter FWA tickets";
            }
        }
        if (badgeFtth) {
            badgeFtth.classList.toggle("blink-alert", ftthBlink);
            badgeFtth.classList.toggle("is-active-filter", state.currentFilter === "OVERDUE_FTTH" || state.currentFilter === "FTTH");
            if (ftthBlink) {
                badgeFtth.title = state.currentFilter === "OVERDUE_FTTH"
                    ? "Filtered: FTTH Overdue tickets only (Click again to show all FTTH)"
                    : "FTTH has overdue escalation tickets! (Click to show overdue only)";
            } else {
                badgeFtth.title = "Filter FTTH tickets";
            }
        }
        if (badgePma) {
            badgePma.classList.toggle("is-active-filter", state.currentFilter === "PMA");
        }

        var filtered = getFilteredTickets();

        filtered.sort(function (a, b) {
            var aMin = parseAgingToMinutes(extractOWSField(a.aging_time) || "");
            var bMin = parseAgingToMinutes(extractOWSField(b.aging_time) || "");
            if (aMin === 0 && a.alarm_time) {
                try {
                    var pA = new Date(a.alarm_time.replace(/-/g, "/"));
                    if (!isNaN(pA.getTime())) aMin = Math.floor(Math.max(0, Date.now() - pA.getTime()) / 60000);
                } catch (eA) { }
            }
            if (bMin === 0 && b.alarm_time) {
                try {
                    var pB = new Date(b.alarm_time.replace(/-/g, "/"));
                    if (!isNaN(pB.getTime())) bMin = Math.floor(Math.max(0, Date.now() - pB.getTime()) / 60000);
                } catch (eB) { }
            }
            return bMin - aMin;
        });

        if (countElem) {
            countElem.textContent =
                filtered.length + (filtered.length === 1 ? " ticket" : " tickets");
        }

        if (!container) return;

        if (state.loading) {
            container.innerHTML =
                '<div class="custom-wo-loading">Loading work orders...</div>';
            return;
        }

        if (filtered.length === 0) {
            container.innerHTML =
                '<div class="custom-wo-empty-state">' +
                '  <div class="custom-wo-empty-icon">&#9638;</div>' +
                '  <div class="custom-wo-empty-title">No Work Orders Found</div>' +
                '  <div class="custom-wo-empty-desc">Click "+" to create or monitor critical tickets.</div>' +
                "</div>";
            return;
        }

        var html = "";
        for (var i = 0; i < filtered.length; i++) {
            var ticket = filtered[i];
            var orderId = extractOWSField(ticket.id || ticket.orderid || "-");
            var domain = extractOWSField(ticket.tt_domain || ticket.domain || "-");
            var status = extractOWSField(ticket.ticket_status || ticket.alarm_status || "-");
            var statusClass = getStatusClass(status);

            var isPMA = orderId.startsWith("PMA-") || ticket.ticket_type === "PMA" || String(domain).toUpperCase() === "PMA";
            var isFtth = String(domain).toUpperCase().indexOf("FTTH") !== -1;
            var domainBadgeClass = isPMA
                ? "custom-domain-badge pma"
                : (isFtth ? "custom-domain-badge ftth" : "custom-domain-badge fwa");
            var domainLabel = isPMA ? "PMA" : domain;

            var title = extractOWSField(ticket.title) || "-";
            var pic = extractOWSField(ticket.pic) || "-";
            var rootCause = extractOWSField(ticket.root_cause) || "-";
            var subRootCause = extractOWSField(ticket.sub_root_cause) || "-";
            var action = extractOWSField(ticket.tt_action) || "-";

            var isNeed = false;
            var suppTitle = "Support: NO NEED";
            var escData = null;
            var agingMinutes = 0;

            if (!isPMA) {
                var rawAgingStr = extractOWSField(ticket.aging_time) || "";
                agingMinutes = parseAgingToMinutes(rawAgingStr);

                if (agingMinutes === 0 && ticket.alarm_time) {
                    try {
                        var parsedAlarm = new Date(ticket.alarm_time.replace(/-/g, "/"));
                        if (!isNaN(parsedAlarm.getTime())) {
                            var diffMs = Math.max(0, Date.now() - parsedAlarm.getTime());
                            agingMinutes = Math.floor(diffMs / (1000 * 60));
                        }
                    } catch (eAlarm) { }
                }

                escData = parseEscalationLevel(ticket.escalationhistory || ticket.escalationlevelnumber, ticket.escalationlevelnumber);
                var suppStatus = String(extractOWSField(ticket.escalationsupport) || "NO_NEED").toUpperCase();
                isNeed = suppStatus === "NEED" || suppStatus === "NEED SUPPORT";
                suppTitle = isNeed ? "Support: NEED" : "Support: NO NEED";
            }

            html += '<div class="custom-wo-card' + (isPMA ? ' custom-wo-card-pma' : '') + (isNeed ? ' need-support' : '') + '">';
            html += '  <div class="custom-wo-card-header">';
            html += '    <div class="custom-detail-title-group">';
            html += '      <span class="custom-ticket-id">' + escapeHtml(orderId) + '</span>';
            html += '      <span class="' + domainBadgeClass + '">' + escapeHtml(domainLabel) + '</span>';
            html += '      <span class="custom-status-pill ' + statusClass + '">' + escapeHtml(status) + '</span>';
            if (!isPMA && escData) {
                html += renderEscalationDotsHTML(escData, orderId, agingMinutes);
                html += '      <span class="custom-support-btn ' + (isNeed ? 'support-need' : 'support-no-need') + '" title="' + escapeHtml(suppTitle) + '">' + (isNeed ? 'Need Support' : 'No Need Support') + '</span>';
            }
            html += '    </div>';
            html += '    <div class="custom-wo-header-actions">';
            html += '      <button type="button" class="custom-wo-action-btn btn-delete" title="Delete Work Order" onclick="window.openDeleteModal(\'' + escapeHtml(orderId) + '\')">&#10005;</button>';
            html += '    </div>';
            html += '  </div>';

            html += '  <div class="custom-wo-card-body">';
            html += '    <div class="custom-detail-grid">';
            html += '      <div class="custom-detail-item full-width"><span class="custom-detail-label">Title</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(title) + '</span></div>';

            if (isPMA) {
                var ptSource = extractOWSField(ticket.cm_orderid || ticket.problem_ticket_id) || "-";
                var planStart = extractOWSField(ticket.plan_start_time || ticket.alarm_time) || "-";
                var planEnd = extractOWSField(ticket.plan_end_time || ticket.clear_time) || "-";
                var linkSegment = extractOWSField(ticket.link_segment_detail || ticket.inter_station) || "-";

                html += '      <div class="custom-detail-item"><span class="custom-detail-label">PT Source</span><span class="custom-detail-sep">:</span><span class="custom-detail-val custom-detail-val-mono">' + escapeHtml(ptSource) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">PIC Contractor</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(pic) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Plan Start</span><span class="custom-detail-sep">:</span><span class="custom-detail-val custom-detail-val-mono">' + escapeHtml(planStart) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Plan End</span><span class="custom-detail-sep">:</span><span class="custom-detail-val custom-detail-val-mono">' + escapeHtml(planEnd) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Root Cause</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(rootCause) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Sub Root Cause</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(subRootCause) + '</span></div>';
                html += '      <div class="custom-detail-item full-width"><span class="custom-detail-label">Link Segment</span><span class="custom-detail-sep">:</span><span class="custom-detail-val" title="' + escapeHtml(linkSegment) + '">' + escapeHtml(linkSegment) + '</span></div>';
            } else {
                var cm = extractOWSField(ticket.cm_orderid) || "-";
                var alarmTime = extractOWSField(ticket.alarm_time) || "-";
                var clearTime = extractOWSField(ticket.clear_time) || "-";
                var agingTime = extractOWSField(ticket.aging_time) || "-";
                var alarmStatus = extractOWSField(ticket.alarm_status) || "-";
                var impactSiteList = extractOWSField(ticket.impactsitelist) || "-";
                var prolongReason = extractOWSField(ticket.prolong_reason) || "-";

                html += '      <div class="custom-detail-item"><span class="custom-detail-label">CM Order ID</span><span class="custom-detail-sep">:</span><span class="custom-detail-val custom-detail-val-mono">' + escapeHtml(cm) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">PIC Contractor</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(pic) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Alarm Time</span><span class="custom-detail-sep">:</span><span class="custom-detail-val custom-detail-val-mono">' + escapeHtml(alarmTime) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Clear Time</span><span class="custom-detail-sep">:</span><span class="custom-detail-val custom-detail-val-mono">' + escapeHtml(clearTime) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Aging Time</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(agingTime) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Alarm Status</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(alarmStatus) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Root Cause</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(rootCause) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Sub Root Cause</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(subRootCause) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Impact Site List</span><span class="custom-detail-sep">:</span><span class="custom-detail-val" title="' + escapeHtml(impactSiteList) + '">' + escapeHtml(impactSiteList) + '</span></div>';
                html += '      <div class="custom-detail-item"><span class="custom-detail-label">Prolong Reason</span><span class="custom-detail-sep">:</span><span class="custom-detail-val" title="' + escapeHtml(prolongReason) + '">' + escapeHtml(prolongReason) + '</span></div>';
            }
            html += '    </div>';

            html += '    <div class="custom-detail-section custom-detail-section-flex">';
            html += '      <div class="custom-detail-section-title">Action Timeline</div>';
            html += renderActionTimeline(action);
            html += '    </div>';
            html += '  </div>';
            html += '  <div class="custom-wo-card-footer">';
            html += '    <button type="button" class="custom-btn-card-details" onclick="window.openDetailModal(\'' + escapeHtml(orderId) + '\')">';
            html += '      <span>View & Edit Details</span>';
            html += '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
            html += '    </button>';
            html += '  </div>';
            html += '</div>';
        }

        container.innerHTML = html;
    }

    // Service Call: Query List
    function loadTicketList(isSilent) {
        if (!isSilent) {
            state.loading = true;
            renderWorkOrderCards();
        }

        if (typeof MessageProcessor === "undefined" || !MessageProcessor.process) {
            state.loading = false;
            showToast("MessageProcessor is not available in this environment.", false);
            renderWorkOrderCards();
            return;
        }

        MessageProcessor.process({
            serviceId: SERVICE_LIST,
            data: { action: "queryTicketList" },
            success: function (res) {
                state.loading = false;
                var data = res.data || [];
                state.tickets = Array.isArray(data) ? data : [];
                state.fwaNum = res.fwaNum || 0;
                state.ftthNum = res.ftthNum || 0;
                state.pmaNum = res.pmaNum || 0;
                setupHeaderControls();
                setupFilterSwitcher();
                setupWorkOrderControls();
                renderAddModalDOM();
                renderDetailModalDOM();
                renderDeleteModalDOM();
                renderEscalationModalDOM();
                renderSupportModalDOM();
                renderLogModalDOM();
                renderConflictModalDOM();
                renderWorkOrderCards();
                updateLastRefreshed();
            },
            error: function (err) {
                state.loading = false;
                console.error("Failed to query ticket list:", err);
                showToast("Load failed. Please refresh.", false);
                renderWorkOrderCards();
            },
        });
    }

    window.filterByDomain = function (domainKey) {
        state.currentFilter = domainKey;
        try {
            localStorage.setItem(SAVED_FILTER_KEY, domainKey);
        } catch (e) { }
        setupFilterSwitcher();
        renderWorkOrderCards();
    };

    window.refreshTicketData = function () {
        loadTicketList();
    };

    // Add Modal Actions
    function fetchRunningTickets(domainOpt, keywordOpt) {
        return new Promise(function (resolve) {
            var reqData = {};
            if (domainOpt && domainOpt !== "ALL") {
                reqData.domain = domainOpt;
            }
            if (keywordOpt) {
                reqData.orderid = String(keywordOpt).trim();
            }

            MessageProcessor.process({
                serviceId: SERVICE_RUNNING_TT,
                data: reqData,
                success: function (res) {
                    var list = [];
                    if (Array.isArray(res)) {
                        list = res;
                    } else if (res && Array.isArray(res.results)) {
                        list = res.results;
                    }
                    var existingMap = {};
                    (state.runningTickets || []).forEach(function (item) {
                        if (item && item.orderid) existingMap[String(item.orderid).trim()] = item;
                    });
                    list.forEach(function (item) {
                        if (item && item.orderid) existingMap[String(item.orderid).trim()] = item;
                    });
                    state.runningTickets = Object.values(existingMap);
                    resolve(state.runningTickets);
                },
                error: function () {
                    resolve(state.runningTickets || []);
                },
            });
        });
    }

    window.onAddDomainChange = function () {
        var domainSelect = document.getElementById("incwoAddDomain");
        var dom = domainSelect ? domainSelect.value : "";
        fetchRunningTickets(dom).then(function () {
            var input = document.getElementById("incwoAddTicketId");
            window.renderTicketDropdown(input ? input.value : "");
        });
    };

    window.renderTicketDropdown = function (query) {
        var dropdown = document.getElementById("incwoAddTicketDropdown");
        if (!dropdown) return;

        var q = (query || "").trim().toLowerCase();
        var matches = (state.runningTickets || []).filter(function (t) {
            var orderId = String(t.orderid || "").toLowerCase();
            var title = String(t.title || "").toLowerCase();
            var domain = String(t.domain || "").toLowerCase();
            if (!q) return true;
            return orderId.indexOf(q) !== -1 || title.indexOf(q) !== -1 || domain.indexOf(q) !== -1;
        });

        if (matches.length === 0) {
            dropdown.innerHTML = '<div class="custom-autocomplete-empty">No running tickets found</div>';
            dropdown.style.display = "block";
            return;
        }

        var html = "";
        var displayMatches = matches.slice(0, 20);
        var existingOrderIds = (state.tickets || []).map(function (t) {
            return String(t.id || t.orderid || "").trim();
        });

        displayMatches.forEach(function (t) {
            var rawDomain = extractOWSField(t.domain) || "FWA";
            var domUpper = rawDomain.toUpperCase();
            var orderId = extractOWSField(t.orderid);
            var isPMA = orderId.startsWith("PMA-") || domUpper === "PMA";
            var badgeClass = isPMA
                ? "custom-autocomplete-badge-pma"
                : (domUpper === "FTTH" ? "custom-autocomplete-badge-ftth" : "custom-autocomplete-badge-fwa");
            var title = extractOWSField(t.title);
            var isAdded = existingOrderIds.includes(String(orderId).trim());

            var itemClass = "custom-autocomplete-item" + (isAdded ? " custom-autocomplete-item-added" : "");
            var clickHandler = isAdded
                ? ""
                : ' onclick="window.selectTicketFromDropdown(\'' +
                  escapeHtml(orderId) +
                  "', '" +
                  escapeHtml(isPMA ? "PMA" : rawDomain) +
                  '\')"';

            html +=
                '<div class="' +
                itemClass +
                '"' +
                clickHandler +
                ">" +
                '  <div class="custom-autocomplete-item-left">' +
                '    <span class="custom-autocomplete-tt-id">' +
                escapeHtml(orderId) +
                "</span>" +
                (title
                    ? '    <span class="custom-autocomplete-tt-title" title="' +
                      escapeHtml(title) +
                      '">' +
                      escapeHtml(title) +
                      "</span>"
                    : "") +
                "  </div>" +
                '  <div class="custom-autocomplete-item-right">' +
                (isAdded ? '<span class="custom-autocomplete-badge custom-autocomplete-badge-added">Added</span>' : "") +
                '    <span class="custom-autocomplete-badge ' +
                badgeClass +
                '">' +
                escapeHtml(isPMA ? "PMA" : rawDomain) +
                "</span>" +
                "  </div>" +
                "</div>";
        });

        if (matches.length > 20) {
            html += '<div class="custom-autocomplete-empty" style="font-size: 11px; padding: 6px;">Showing first 20 of ' + matches.length + ' tickets. Type to filter...</div>';
        }

        dropdown.innerHTML = html;
        dropdown.style.display = "block";
    };

    window.onAddTicketInput = function (e) {
        var val = e.target.value;
        var domainSelect = document.getElementById("incwoAddDomain");
        if (domainSelect) {
            var cleanVal = (val || "").trim().toUpperCase();
            if (cleanVal.startsWith("PMA") || cleanVal === "PMA") {
                domainSelect.value = "PMA";
            }
        }
        var dom = domainSelect ? domainSelect.value : "";
        window.renderTicketDropdown(val);

        clearTimeout(state.searchDebounceTimer);
        state.searchDebounceTimer = setTimeout(function () {
            fetchRunningTickets(dom, val).then(function () {
                window.renderTicketDropdown(val);
            });
        }, 250);
    };

    window.onAddTicketFocus = function (e) {
        var val = e.target.value;
        window.renderTicketDropdown(val);
    };

    window.selectTicketFromDropdown = function (orderId, domain) {
        var input = document.getElementById("incwoAddTicketId");
        var domainSelect = document.getElementById("incwoAddDomain");
        var dropdown = document.getElementById("incwoAddTicketDropdown");

        if (input) input.value = orderId;
        if (domainSelect) {
            var domUpper = (domain || "").toUpperCase();
            if (domUpper === "PMA" || (orderId && orderId.toUpperCase().startsWith("PMA-"))) {
                domainSelect.value = "PMA";
            } else if (domUpper.indexOf("FTTH") !== -1) {
                domainSelect.value = "FTTH";
            } else {
                domainSelect.value = "FWA";
            }
        }
        if (dropdown) dropdown.style.display = "none";
    };

    // Close autocomplete dropdown when clicking outside
    document.addEventListener("click", function (e) {
        var dropdown = document.getElementById("incwoAddTicketDropdown");
        var input = document.getElementById("incwoAddTicketId");
        if (dropdown && dropdown.style.display !== "none") {
            if (e.target !== input && !dropdown.contains(e.target)) {
                dropdown.style.display = "none";
            }
        }
    });

    window.openAddModal = function () {
        renderAddModalDOM();

        var modal = document.getElementById("incwoAddModal");
        var domainSelect = document.getElementById("incwoAddDomain");
        var ticketInput = document.getElementById("incwoAddTicketId");
        var dropdown = document.getElementById("incwoAddTicketDropdown");

        if (domainSelect) {
            domainSelect.value = (state.currentFilter === "PMA" || state.currentFilter === "FTTH") ? state.currentFilter : "FWA";
        }
        if (ticketInput) ticketInput.value = "";
        if (dropdown) dropdown.style.display = "none";
        if (modal) modal.style.display = "flex";

        // Preload seluruh running tickets (INC + PMA) agar dropdown langsung terisi lengkap
        fetchRunningTickets("").then(function () {
            if (modal && modal.style.display === "flex") {
                window.renderTicketDropdown("");
            }
        });
    };

    window.closeAddModal = function () {
        var modal = document.getElementById("incwoAddModal");
        if (modal) modal.style.display = "none";
        var dropdown = document.getElementById("incwoAddTicketDropdown");
        if (dropdown) dropdown.style.display = "none";
    };

    window.recordModalMouseDown = function (e) {
        state.modalMouseDownTarget = e.target;
    };

    window.closeAddModalOnBackdrop = function (e) {
        if (e.target.id === "incwoAddModal" && state.modalMouseDownTarget === e.target) {
            window.closeAddModal();
        }
        state.modalMouseDownTarget = null;
    };

    window.submitAddTicket = function (e) {
        if (e && e.preventDefault) e.preventDefault();

        var domainSelect = document.getElementById("incwoAddDomain");
        var ticketInput = document.getElementById("incwoAddTicketId");
        var submitBtn = document.getElementById("incwoAddSubmitBtn");

        var domain = domainSelect ? domainSelect.value : "";
        var ticketId = ticketInput ? ticketInput.value.trim() : "";

        if (ticketId.toUpperCase().startsWith("PMA-")) {
            domain = "PMA";
            if (domainSelect) domainSelect.value = "PMA";
        }

        if (!domain || !ticketId) {
            showToast("Domain and TT Number are required.", false);
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Creating...";
        }

        MessageProcessor.process({
            serviceId: SERVICE_CREATE,
            data: { orderid: ticketId, domain: domain },
            success: function (res) {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Confirm";
                }
                if (res && res.code && res.code != 200) {
                    showToast(res.message || "Failed to create ticket", false);
                    return;
                }
                window.closeAddModal();
                showToast("Work order created successfully!", true);
                setTimeout(loadTicketList, 500);
            },
            error: function (err) {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = "Confirm";
                }
                showToast("Create failed: " + (err.message || "Unknown error"), false);
            },
        });
    };

    // Detail Modal Actions
    function startMonitorHeartbeatLoop(orderId) {
        if (state.lockHeartbeatTimer) {
            clearInterval(state.lockHeartbeatTimer);
        }
        state.lockHeartbeatTimer = setInterval(function () {
            if (!state.activeLockedOrderId) return;
            var currentId = state.activeLockedOrderId;
            // Check if Process TT took over the lock in DB
            fetchDatabaseTicketLock(currentId, function (dbLock) {
                if (!state.activeLockedOrderId) return;
                if (dbLock && dbLock.tabId !== MONITOR_TAB_ID && dbLock.holder === "PROCESS_TT") {
                    var dbForce = Number(dbLock.forceSeq || 0);
                    var myForce = Number(state.modalForceSeq || 0);
                    var dbOpenedEarlier = Number(dbLock.openedAt || 0) < state.modalOpenedAt && myForce === 0;
                    if (dbForce > myForce || dbOpenedEarlier) {
                        state.modalForceSeq = dbForce;
                        // Do NOT clear DB session_interface because another session took over the lock!
                        releaseMonitorTicketLock(true);
                        window.closeEscalationConfirmModal();
                        window.closeSupportConfirmModal();
                        window.closeDetailModal(true);
                        showConflictAlertModal(
                            currentId,
                            "Ticket " + currentId + " was taken over in " + formatLockHolderDisplay(dbLock) + ". Please close the Process TT page first to avoid data conflicts, then proceed.",
                            function () {
                                verifyAndProceedIfProcessTTClosed(currentId, function () {
                                    proceedOpenDetailModal(currentId, true);
                                });
                            }
                        );
                        return;
                    }
                }
                // Refresh localStorage only (no repeated DB _update every 3s!)
                writeMonitorTicketLock(currentId, state.modalOpenedAt, false);
            });
        }, HEARTBEAT_INTERVAL_MS);
    }

    function proceedOpenDetailModal(orderId, isForceOverwrite) {
        renderDetailModalDOM();
        var modal = document.getElementById("incwoDetailModal");
        var headerOrderId = document.getElementById("incwoDetailHeaderOrderId");
        if (headerOrderId) headerOrderId.textContent = orderId;

        state.selectedSegments = [];
        state.modalOpenedAt = Date.now();
        if (isForceOverwrite) {
            state.modalForceSeq = Date.now();
        }

        Promise.all([
            fetchTicketDetail(orderId),
        ])
            .then(function (results) {
                var detailRes = results[0] || {};
                var detail = detailRes.data || {};
                var vendorList = detailRes.vendorList || [];

                if (detailRes.current_user) {
                    state.currentUser = detailRes.current_user;
                }

                // Cross-laptop DB lock check before opening modal (only conflict if locked by Process TT)
                if (!isForceOverwrite) {
                    var existingDbLock = parseTicketLockString(extractOWSField(detail.session_interface), DB_LOCK_TTL_MS);
                    if (existingDbLock && existingDbLock.tabId !== MONITOR_TAB_ID && existingDbLock.holder === "PROCESS_TT") {
                        showConflictAlertModal(
                            orderId,
                            "Ticket " + orderId + " is currently open in " + formatLockHolderDisplay(existingDbLock) + ". Please close the Process TT page first to avoid data conflicts, then proceed.",
                            function () {
                                verifyAndProceedIfProcessTTClosed(orderId, function () {
                                    proceedOpenDetailModal(orderId, true);
                                });
                            }
                        );
                        return;
                    }
                }

                // Claim lock in localStorage + OWS Database
                writeMonitorTicketLock(orderId, state.modalOpenedAt, true);
                startMonitorHeartbeatLoop(orderId);

                if (isForceOverwrite) {
                    broadcastTicketSync("MONITOR_FORCE_OVERWRITE", orderId, {
                        openedAt: state.modalOpenedAt,
                        forceSeq: state.modalForceSeq
                    });
                } else {
                    broadcastTicketSync("MONITOR_TRY_OPEN_POPUP", orderId, {
                        openedAt: state.modalOpenedAt
                    });
                }

                state.currentDetail = detail;
                state.vendorList = vendorList;
                state.detailEscalationLogs = Array.isArray(detailRes.escalation_logs) ? detailRes.escalation_logs : [];

                // Simpan snapshot data live saat modal pertama kali dibuka untuk deteksi konflik sebelum Save
                state.initialModalSnapshot = {
                    orderid: String(orderId || "").trim().toUpperCase(),
                    tt_action: String(extractOWSField(detail.tt_action) || "").trim(),
                    responsibility: String(extractOWSField(detail.responsibility) || "").trim()
                };

                // Sinkronkan data aging_time & alarm_time dari ticket list kartu yang valid jika tidak disediakan oleh detail service
                var existingCardTicket = (state.tickets || []).find(function (t) {
                    return String(t.id || t.orderid || "").trim().toUpperCase() === String(orderId).trim().toUpperCase();
                });
                if (existingCardTicket) {
                    if (!state.currentDetail.aging_time && existingCardTicket.aging_time) {
                        state.currentDetail.aging_time = existingCardTicket.aging_time;
                    }
                    if (!state.currentDetail.alarm_time && existingCardTicket.alarm_time) {
                        state.currentDetail.alarm_time = existingCardTicket.alarm_time;
                    }
                }

                populateDetailModal(detail, vendorList);
                if (modal) modal.style.display = "flex";
            })
            .catch(function (err) {
                releaseMonitorTicketLock();
                showToast("Failed to fetch detail: " + (err.message || "Unknown error"), false);
            });
    }

    window.openDetailModal = function (orderId) {
        var activeLock = readActiveTicketLock(orderId);
        // Instant same-laptop lock check (only conflict if locked by Process TT)
        if (activeLock && activeLock.tabId !== MONITOR_TAB_ID && activeLock.holder === "PROCESS_TT") {
            showConflictAlertModal(
                orderId,
                "Ticket " + orderId + " is already open in " + formatLockHolderDisplay(activeLock) + ". Please close the Process TT page first to avoid data conflicts, then proceed.",
                function () {
                    verifyAndProceedIfProcessTTClosed(orderId, function () {
                        proceedOpenDetailModal(orderId, true);
                    });
                }
            );
            return;
        }
        proceedOpenDetailModal(orderId, false);
    };

    function fetchTicketDetail(orderId) {
        return new Promise(function (resolve, reject) {
            MessageProcessor.process({
                serviceId: SERVICE_DETAIL,
                data: { orderid: orderId },
                success: function (res) {
                    resolve(res || {});
                },
                error: function (err) {
                    reject(err);
                },
            });
        });
    }

    function fetchPicList() {
        return new Promise(function (resolve, reject) {
            MessageProcessor.process({
                serviceId: SERVICE_PIC_LIST,
                data: { start: 0, limit: 100 },
                success: function (res) {
                    resolve(res.results || []);
                },
                error: function (err) {
                    reject(err);
                },
            });
        });
    }

    function populateDetailModal(detail, vendorList) {
        var actionElem = document.getElementById("incwoDetailAction");
        if (actionElem) actionElem.value = extractOWSField(detail.tt_action);

        var picSelect = document.getElementById("incwoDetailPic");
        var orderIdStr = String(detail.orderid || detail.id || detail.order_id || "").trim().toUpperCase();
        var isPMA = orderIdStr.startsWith("PMA-") || String(detail.tt_domain || detail.domain || "").toUpperCase() === "PMA";

        if (picSelect) {
            if (isPMA) {
                // PMA tetap read-only / disabled
                var picVal = extractOWSField(detail.pic) || "No PIC Assigned";
                picSelect.innerHTML = '<option value="">' + escapeHtml(picVal) + '</option>';
                picSelect.disabled = true;
            } else {
                // INC Ticket: Vendor dropdown yang dapat dipilih
                picSelect.disabled = false;
                var currentResp = extractOWSField(detail.responsibility) || "";
                var currentPicName = extractOWSField(detail.pic) || "";

                var optionsHtml = '<option value="">-- No PIC Assigned --</option>';
                var foundMatch = false;

                (vendorList || []).forEach(function (v) {
                    var vId = v.id || "";
                    var vName = v.name || v.label || vId;
                    var isSelected = (currentResp && vId === currentResp) || (!currentResp && currentPicName && vName.toLowerCase() === currentPicName.toLowerCase());
                    if (isSelected) foundMatch = true;
                    optionsHtml += '<option value="' + escapeHtml(vId) + '" data-name="' + escapeHtml(vName) + '"' + (isSelected ? ' selected' : '') + '>' + escapeHtml(vName) + '</option>';
                });

                // Jika currentPicName ada tapi tidak ada di vendorList, tambahkan sebagai opsi awal
                if (!foundMatch && currentPicName && currentPicName !== "-") {
                    optionsHtml = '<option value="' + escapeHtml(currentResp) + '" data-name="' + escapeHtml(currentPicName) + '" selected>' + escapeHtml(currentPicName) + '</option>' + optionsHtml;
                }

                picSelect.innerHTML = optionsHtml;
            }
        }

        // Setup Escalation & Support khusus INC Ticket
        var escSection = document.getElementById("incwoIncEscalationSection");
        if (escSection) {
            if (!isPMA) {
                escSection.style.display = "flex";
                var initialLevel = 0;
                if (detail.escalationlevelnumber !== undefined && detail.escalationlevelnumber !== null && !isNaN(Number(detail.escalationlevelnumber))) {
                    initialLevel = Number(detail.escalationlevelnumber);
                }

                // Proteksi Anti-Reset: periksa log eskalasi yang tersimpan di tabel incwo_escalation_log
                var maxLogLevel = 0;
                if (Array.isArray(state.detailEscalationLogs) && state.detailEscalationLogs.length > 0) {
                    state.detailEscalationLogs.forEach(function (row) {
                        var lType = String(row.log_type || "").toUpperCase();
                        var lvl = Number(row.esc_level || 0);
                        if (lType.indexOf("ESCALATION") !== -1 && !isNaN(lvl) && lvl > maxLogLevel) {
                            maxLogLevel = lvl;
                        }
                    });
                }

                // Fallback ekstra jika escalationlevel bertuliskan angka atau string "4"
                if (initialLevel === 0 && detail.escalationlevel) {
                    var parsedRaw = parseInt(detail.escalationlevel, 10);
                    if (!isNaN(parsedRaw) && parsedRaw > 0) {
                        initialLevel = parsedRaw;
                    }
                }

                initialLevel = Math.max(initialLevel, maxLogLevel);
                state.tempEscalationLevel = initialLevel;
                state.tempEscalationHistory = [];

                var suppStatus = String(extractOWSField(detail.escalationsupport) || "NO_NEED").toUpperCase();
                var normSupp = (suppStatus === "NEED" || suppStatus === "NEED SUPPORT") ? "NEED" : "NO_NEED";
                state.tempEscalationSupport = normSupp;
                state.initialEscalationSupport = normSupp;

                state.pendingNewLogs = [];
                state.tempPendingSupportReason = "";

                // Gabungkan atau utamakan log dari tabel model incwo_escalation_log jika ada
                if (Array.isArray(state.detailEscalationLogs) && state.detailEscalationLogs.length > 0) {
                    state.tempEscalationHistory = state.detailEscalationLogs.map(function (row) {
                        return {
                            log_type: row.log_type,
                            level: row.esc_level,
                            esc_level: row.esc_level,
                            support_status: row.support_status,
                            time: row.create_time,
                            operator_id: row.operator_id || "",
                            operator_name: row.operator_name || row.by || "",
                            by: row.operator_name || row.operator_id,
                            description: row.description || "",
                            note: row.description || ""
                        };
                    });
                }

                // Default closed / collapsed agar area Action textarea lega
                var collapseBody = document.getElementById("incwoEscalationCollapseBody");
                var collapseIcon = document.getElementById("incwoEscalationCollapseIcon");
                if (collapseBody) collapseBody.style.display = "none";
                if (collapseIcon) collapseIcon.classList.remove("is-expanded");

                updateEscalationModalUI();
            } else {
                escSection.style.display = "none";
            }
        }

        // Tampilkan field Activity Summary & Activity List khusus PMA secara read-only tanpa border
        var pmaContainer = document.getElementById("incwoPmaExtraFields");

        if (pmaContainer) {
            if (isPMA) {
                pmaContainer.style.display = "flex";
                var summaryElem = document.getElementById("incwoDetailActivitySummary");
                var notesElem = document.getElementById("incwoDetailNocActivityNotes");
                if (summaryElem) summaryElem.textContent = extractOWSField(detail.activity_summary) || "-";
                if (notesElem) notesElem.textContent = extractOWSField(detail.noc_activity_notes) || "-";
            } else {
                pmaContainer.style.display = "none";
            }
        }
    }

    function updateEscalationModalUI() {
        var currentLevel = state.tempEscalationLevel || 0;
        var detailAgingStr = state.currentDetail ? (extractOWSField(state.currentDetail.aging_time) || "") : "";
        var detailAgingMinutes = parseAgingToMinutes(detailAgingStr);

        // Fallback jika aging_time belum terisi di detail tapi ada alarm_time
        if (detailAgingMinutes === 0 && state.currentDetail && state.currentDetail.alarm_time) {
            try {
                var parsedAlarm = new Date(state.currentDetail.alarm_time.replace(/-/g, "/"));
                if (!isNaN(parsedAlarm.getTime())) {
                    var diffMs = Math.max(0, Date.now() - parsedAlarm.getTime());
                    detailAgingMinutes = Math.floor(diffMs / (1000 * 60));
                }
            } catch (eAl) { }
        }

        var blinkMap = getEscalationBlinkMap(detailAgingMinutes, currentLevel);

        for (var lvl = 1; lvl <= 5; lvl++) {
            var btn = document.getElementById("incwoStepBtn" + lvl);
            if (btn) {
                var isActive = lvl <= currentLevel;
                var isBlinking = !isActive && Boolean(blinkMap[lvl]);
                var btnClass = "custom-modal-step-btn";
                if (isActive) {
                    btnClass += " is-active-l" + lvl;
                } else if (isBlinking) {
                    btnClass += " blink-alert-l" + lvl;
                }
                btn.className = btnClass;
            }
        }

        // Support Button
        var suppBtn = document.getElementById("incwoDetailSupportBtn");
        var suppText = document.getElementById("incwoDetailSupportText");
        var isNeed = state.tempEscalationSupport === "NEED";
        if (suppBtn) {
            suppBtn.className = "custom-support-btn " + (isNeed ? "support-need" : "support-no-need");
        }
        if (suppText) {
            suppText.textContent = isNeed ? "Need Support" : "No Need Support";
        }

        // Update Summary Badge on Collapse Bar
        var badge = document.getElementById("incwoEscalationSummaryBadge");
        if (badge) {
            badge.textContent = currentLevel > 0 ? "Level " + currentLevel : "No Level";
            badge.className = "custom-escalation-summary-badge" + (currentLevel > 0 ? " is-active-l" + currentLevel : "");
        }

        // Render History Log
        var histContainer = document.getElementById("incwoEscalationHistoryLog");
        if (histContainer) {
            var historyList = state.tempEscalationHistory || [];
            if (historyList.length === 0) {
                histContainer.innerHTML = '<span>No escalation history recorded.</span>';
            } else {
                var htmlHist = '<div class="custom-escalation-history-header">' +
                    '<span style="font-size: 11px; font-weight: 600; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.04em;">Escalation Logs (' + historyList.length + ')</span>' +
                    '<button type="button" class="custom-btn-export-log" id="incwoBtnExportLog" onclick="window.exportEscalationLogsToExcel()">' +
                    '  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                    '  <span>Export Log</span>' +
                    '</button>' +
                    '</div>';

                historyList.forEach(function (item) {
                    htmlHist += '<div class="custom-modal-escalation-history-item">';
                    htmlHist += '  <div class="custom-history-main-row">';
                    var lType = String(item.log_type || item.type || "").toUpperCase();
                    var isSupport = (lType === "NEED_SUPPORT" || lType === "SUPPORT");

                    if (isSupport) {
                        var st = item.support_status || item.status;
                        var isNeedSupp = String(st).toUpperCase() === "NEED";
                        var badgeColor = isNeedSupp ? "#f87171" : "#4ade80";
                        var badgeBg = isNeedSupp ? "rgba(239, 68, 68, 0.15)" : "rgba(34, 197, 94, 0.15)";
                        var label = isNeedSupp ? "Need Support" : "No Need Support";
                        htmlHist += '    <span style="color: ' + badgeColor + '; background: ' + badgeBg + '; padding: 1px 6px; border-radius: 4px; font-weight: 600;">' + label + '</span>';
                        htmlHist += '    <span>Set at ' + escapeHtml(formatTimeToUTC7(item.time)) + ' by <strong style="color: #38bdf8;">' + escapeHtml(item.by || "-") + '</strong></span>';
                    } else {
                        var lvlVal = item.esc_level !== undefined && item.esc_level !== null ? item.esc_level : (item.level !== undefined ? item.level : "-");
                        htmlHist += '    <span style="color: #fafafa; font-weight: 600;">Level ' + lvlVal + ':</span>';
                        htmlHist += '    <span>Triggered at ' + escapeHtml(formatTimeToUTC7(item.time)) + ' by <strong style="color: #38bdf8;">' + escapeHtml(item.by || "-") + '</strong></span>';
                    }
                    htmlHist += '  </div>';

                    var desc = item.description || item.note || "";
                    if (desc) {
                        htmlHist += '  <div class="custom-history-note-row" style="padding-left: 8px; border-left: 2px solid rgba(255,255,255,0.15); color: #e4e4e7; font-size: 11px; margin-top: 3px; font-style: italic; word-break: break-word;">';
                        htmlHist += '    "' + escapeHtml(desc) + '"';
                        htmlHist += '  </div>';
                    }
                    htmlHist += '</div>';
                });
                histContainer.innerHTML = htmlHist;
            }
        }
    }

    window.toggleEscalationCollapse = function () {
        var body = document.getElementById("incwoEscalationCollapseBody");
        var icon = document.getElementById("incwoEscalationCollapseIcon");
        if (!body) return;
        var isClosed = body.style.display === "none" || body.style.display === "";
        if (isClosed) {
            body.style.display = "flex";
            if (icon) icon.classList.add("is-expanded");
        } else {
            body.style.display = "none";
            if (icon) icon.classList.remove("is-expanded");
        }
    };

    // Modal Escalation Interactions
    window.setEscalationLevel = function (targetLevel) {
        targetLevel = Number(targetLevel);
        var currentLevel = Number(state.tempEscalationLevel || 0);

        // Rule: Sequential escalation only (1 -> 2 -> 3 -> 4)
        if (targetLevel > currentLevel + 1) {
            var nextAllowed = currentLevel + 1;
            showToast("Sequential order required! Please select Level " + nextAllowed + " first.", false);
            return;
        }

        // Rule: No rollback allowed (cannot downgrade to lower levels)
        if (targetLevel < currentLevel) {
            showToast("Rollback is not allowed. Escalation level cannot be downgraded.", false);
            return;
        }

        // Open Custom In-App Confirmation Modal (Replacing browser alert/confirm)
        renderEscalationModalDOM();
        state.pendingEscalationLevel = targetLevel;
        var targetText = document.getElementById("incwoPendingEscalationTargetText");
        var isRepeat = (targetLevel === currentLevel);
        if (targetText) {
            targetText.textContent = "Level " + targetLevel + (isRepeat ? " (Add Log / Progress)" : "");
        }
        var modal = document.getElementById("incwoEscalationModal");
        if (modal) modal.style.display = "flex";
    };

    window.closeEscalationConfirmModal = function () {
        var modal = document.getElementById("incwoEscalationModal");
        if (modal) modal.style.display = "none";
        state.pendingEscalationLevel = null;
    };

    window.closeEscalationConfirmModalOnBackdrop = function (e) {
        if (e.target.id === "incwoEscalationModal" && state.modalMouseDownTarget === e.target) {
            window.closeEscalationConfirmModal();
        }
        state.modalMouseDownTarget = null;
    };

    window.executeConfirmedEscalation = function () {
        var targetLevel = state.pendingEscalationLevel;
        if (!targetLevel) {
            window.closeEscalationConfirmModal();
            return;
        }

        var reasonInput = document.getElementById("incwoEscalationReasonInput");
        var reasonText = reasonInput ? reasonInput.value.trim() : "";

        if (!reasonText) {
            showToast("Reason / Description is mandatory for escalation.", false);
            if (reasonInput) reasonInput.focus();
            return;
        }

        if (!state.currentDetail) {
            window.closeEscalationConfirmModal();
            return;
        }

        var orderId = extractOWSField(
            state.currentDetail.orderid || state.currentDetail.id
        );

        var now = new Date();
        var timeStr = formatTimeToUTC7(now);

        var currentUser = state.currentUser || "";
        if (!currentUser) {
            try {
                if (typeof _runtime !== "undefined" && _runtime && _runtime.userName) {
                    currentUser = _runtime.userName;
                } else if (window.currentUser) {
                    currentUser = window.currentUser;
                } else if (window.parent && window.parent.currentUser) {
                    currentUser = window.parent.currentUser;
                }
            } catch (eUser) {
                currentUser = "";
            }
        }

        var confirmBtn = document.getElementById("incwoConfirmEscalateBtn");
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = "Saving...";
        }

        var curSupp = state.tempEscalationSupport || "NO_NEED";
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

        var payloadData = {
            orderid: orderId,
            escalationlevelnumber: targetLevel,
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
                state.tempEscalationLevel = targetLevel;
                if (state.currentDetail) {
                    state.currentDetail.escalationlevelnumber = targetLevel;
                }
                state.tempEscalationHistory = state.tempEscalationHistory || [];
                state.tempEscalationHistory.push(newEscLog);

                // Auto-inject ke baris paling atas draft chronology di textarea Action
                var padZero = function (n) { return n < 10 ? "0" + n : String(n); };
                var timeHHmm = padZero(now.getHours()) + ":" + padZero(now.getMinutes());
                var opDisplay = (currentUser || "Operator").trim();
                var logLine = timeHHmm + " [ESCALATION LEVEL " + targetLevel + "] " + reasonText + " (Operator " + opDisplay + ")";

                var actionTextarea = document.getElementById("incwoDetailAction");
                if (actionTextarea) {
                    var currentText = actionTextarea.value ? actionTextarea.value.trim() : "";
                    actionTextarea.value = currentText ? logLine + "\n" + currentText : logLine;
                    if (state.currentDetail) {
                        state.currentDetail.tt_action = actionTextarea.value;
                    }
                }

                broadcastTicketSync("MONITOR_TICKET_SAVED", orderId);

                if (reasonInput) reasonInput.value = "";
                window.closeEscalationConfirmModal();
                updateEscalationModalUI();
                showToast("Escalated to Level " + targetLevel + " successfully! Injected to chronology draft.", true);
                setTimeout(loadTicketList, 500);
            },
            error: function (err) {
                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = "Confirm";
                }
                showToast("Escalation failed: " + (err.message || "Unknown error"), false);
            }
        });
    };

    window.toggleSupportStatus = function () {
        var currentSupp = state.tempEscalationSupport || "NO_NEED";
        var targetSupp = currentSupp === "NEED" ? "NO_NEED" : "NEED";

        renderSupportModalDOM();
        state.pendingSupportStatus = targetSupp;

        var targetText = document.getElementById("incwoPendingSupportTargetText");
        var modalTitle = document.getElementById("incwoSupportModalTitle");
        var modalIcon = document.getElementById("incwoSupportModalIcon");
        var reasonInput = document.getElementById("incwoSupportReasonInput");

        if (reasonInput) reasonInput.value = "";
        if (targetSupp === "NEED") {
            if (targetText) {
                targetText.textContent = "Need Support";
                targetText.style.color = "#f87171";
            }
            if (modalTitle) modalTitle.textContent = "Request Support";
            if (modalIcon) {
                modalIcon.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
                modalIcon.style.color = "#f87171";
            }
        } else {
            if (targetText) {
                targetText.textContent = "No Need Support";
                targetText.style.color = "#4ade80";
            }
            if (modalTitle) modalTitle.textContent = "Cancel Support Request";
            if (modalIcon) {
                modalIcon.style.backgroundColor = "rgba(34, 197, 94, 0.15)";
                modalIcon.style.color = "#4ade80";
            }
        }

        var modal = document.getElementById("incwoSupportModal");
        if (modal) modal.style.display = "flex";
    };

    window.closeSupportConfirmModal = function () {
        var modal = document.getElementById("incwoSupportModal");
        if (modal) modal.style.display = "none";
        state.pendingSupportStatus = null;
    };

    window.closeSupportConfirmModalOnBackdrop = function (e) {
        if (e.target.id === "incwoSupportModal" && state.modalMouseDownTarget === e.target) {
            window.closeSupportConfirmModal();
        }
        state.modalMouseDownTarget = null;
    };

    window.executeConfirmedSupport = function () {
        var targetSupp = state.pendingSupportStatus;
        if (!targetSupp) {
            window.closeSupportConfirmModal();
            return;
        }

        var reasonInput = document.getElementById("incwoSupportReasonInput");
        var reasonText = reasonInput ? reasonInput.value.trim() : "";

        if (!reasonText) {
            showToast("Reason / Description is mandatory for support status update.", false);
            if (reasonInput) reasonInput.focus();
            return;
        }

        if (!state.currentDetail) {
            window.closeSupportConfirmModal();
            return;
        }

        var orderId = extractOWSField(
            state.currentDetail.orderid || state.currentDetail.id
        );

        var now = new Date();
        var timeStr = formatTimeToUTC7(now);

        var currentUser = state.currentUser || "";
        if (!currentUser) {
            try {
                if (typeof _runtime !== "undefined" && _runtime && _runtime.userName) {
                    currentUser = _runtime.userName;
                } else if (window.currentUser) {
                    currentUser = window.currentUser;
                } else if (window.parent && window.parent.currentUser) {
                    currentUser = window.parent.currentUser;
                }
            } catch (eUser) {
                currentUser = "";
            }
        }

        var confirmBtn = document.getElementById("incwoConfirmSupportBtn");
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = "Saving...";
        }

        var curLvl = Number(state.tempEscalationLevel || 0);
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

        var payloadData = {
            orderid: orderId,
            escalationsupport: targetSupp,
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
                state.tempEscalationSupport = targetSupp;
                if (state.currentDetail) {
                    state.currentDetail.escalationsupport = targetSupp;
                }
                state.tempEscalationHistory = state.tempEscalationHistory || [];
                state.tempEscalationHistory.push(newSuppLog);

                // Auto-inject ke baris paling atas draft chronology di textarea Action
                var padZero = function (n) { return n < 10 ? "0" + n : String(n); };
                var timeHHmm = padZero(now.getHours()) + ":" + padZero(now.getMinutes());
                var opDisplay = (currentUser || "Operator").trim();
                var tagLabel = targetSupp === "NEED" ? "NEED SUPPORT" : "NO NEED SUPPORT";
                var logLine = timeHHmm + " [" + tagLabel + "] " + reasonText + " (Operator " + opDisplay + ")";

                var actionTextarea = document.getElementById("incwoDetailAction");
                if (actionTextarea) {
                    var currentText = actionTextarea.value ? actionTextarea.value.trim() : "";
                    actionTextarea.value = currentText ? logLine + "\n" + currentText : logLine;
                    if (state.currentDetail) {
                        state.currentDetail.tt_action = actionTextarea.value;
                    }
                }

                broadcastTicketSync("MONITOR_TICKET_SAVED", orderId);

                if (reasonInput) reasonInput.value = "";
                window.closeSupportConfirmModal();
                updateEscalationModalUI();
                showToast("Support status updated to " + (targetSupp === "NEED" ? "Need Support" : "No Need Support") + " successfully! Injected to chronology draft.", true);
                setTimeout(loadTicketList, 500);
            },
            error: function (err) {
                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = "Confirm";
                }
                showToast("Update support failed: " + (err.message || "Unknown error"), false);
            }
        });
    };

    window.closeDetailModal = function (skipDbClear) {
        releaseMonitorTicketLock(skipDbClear);
        var modal = document.getElementById("incwoDetailModal");
        if (modal) modal.style.display = "none";
        state.currentDetail = null;
        state.initialModalSnapshot = null;
    };

    window.closeDetailModalOnBackdrop = function (e) {
        if (e.target.id === "incwoDetailModal" && state.modalMouseDownTarget === e.target) {
            window.closeDetailModal();
        }
        state.modalMouseDownTarget = null;
    };

    // Escalation Activity Log Modal Popup Actions (Triggered by dots on card)
    window.openEscalationLogModal = function (orderId) {
        if (!orderId || orderId === "-") return;
        renderLogModalDOM();
        var modal = document.getElementById("incwoLogModal");
        var titleElem = document.getElementById("incwoLogModalTitle");
        var bodyElem = document.getElementById("incwoLogModalBody");

        if (titleElem) titleElem.textContent = "ESCALATION LOGS (" + orderId + ")";
        if (bodyElem) {
            bodyElem.innerHTML = '<div style="color: #a1a1aa; font-size: 13px; text-align: center; padding: 24px 0;">Loading escalation logs...</div>';
        }
        if (modal) modal.style.display = "flex";

        state.activeLogOrderId = orderId;
        state.activeLogList = [];

        fetchTicketDetail(orderId)
            .then(function (detailRes) {
                var logs = [];
                if (detailRes && Array.isArray(detailRes.escalation_logs) && detailRes.escalation_logs.length > 0) {
                    logs = detailRes.escalation_logs.map(function (row) {
                        return {
                            log_type: row.log_type,
                            type: (row.log_type === "NEED_SUPPORT" || row.support_status) ? "SUPPORT" : "LEVEL",
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
                } else if (detailRes && detailRes.data) {
                    var parsed = parseEscalationLevel(detailRes.data.escalationhistory || detailRes.data.escalationlevel, detailRes.data.escalationlevelnumber);
                    logs = parsed.history || [];
                }

                state.activeLogList = logs;

                if (titleElem) {
                    titleElem.textContent = "ESCALATION LOGS (" + logs.length + ")";
                }

                if (!bodyElem) return;

                if (!logs || logs.length === 0) {
                    bodyElem.innerHTML = '<div style="color: #a1a1aa; font-size: 13px; text-align: center; padding: 24px 0;">No escalation logs recorded for this ticket.</div>';
                    return;
                }

                var html = "";
                logs.forEach(function (item) {
                    var lType = String(item.log_type || item.type || "").toUpperCase();
                    var isSupport = (lType === "NEED_SUPPORT" || lType === "SUPPORT");
                    var timeStr = formatTimeToUTC7(item.time || item.create_time);
                    var userDisplay = item.by || item.operator_name || item.operator_id || "-";
                    var desc = item.description || item.note || "";

                    html += '<div class="custom-log-item">';
                    html += '  <div class="custom-log-row-top">';

                    if (isSupport) {
                        var st = String(item.support_status || item.status || "NEED").toUpperCase();
                        var isNeed = (st === "NEED" || st === "NEED SUPPORT");
                        var badgeClass = isNeed ? "custom-log-badge-need" : "custom-log-badge-noneed";
                        var badgeText = isNeed ? "Need Support" : "No Need Support";

                        html += '    <span class="' + badgeClass + '">' + badgeText + '</span>';
                        html += '    <span>Set at ' + escapeHtml(timeStr) + ' by <strong class="custom-log-user-highlight">' + escapeHtml(userDisplay) + '</strong></span>';
                    } else {
                        var lvlNum = item.esc_level !== undefined && item.esc_level !== null ? item.esc_level : (item.level !== undefined ? item.level : "-");
                        html += '    <span class="custom-log-level-lbl">Level ' + escapeHtml(lvlNum) + ':</span>';
                        html += '    <span>Triggered at ' + escapeHtml(timeStr) + ' by <strong class="custom-log-user-highlight">' + escapeHtml(userDisplay) + '</strong></span>';
                    }

                    html += '  </div>';

                    if (desc) {
                        html += '  <div class="custom-log-quote-box">';
                        html += '    "' + escapeHtml(desc) + '"';
                        html += '  </div>';
                    }

                    html += '</div>';
                });

                bodyElem.innerHTML = html;
            })
            .catch(function (err) {
                if (bodyElem) {
                    bodyElem.innerHTML = '<div style="color: #ef4444; font-size: 13px; text-align: center; padding: 24px 0;">Failed to load logs: ' + escapeHtml(err.message || "Unknown error") + '</div>';
                }
            });
    };

    window.closeEscalationLogModal = function () {
        var modal = document.getElementById("incwoLogModal");
        if (modal) modal.style.display = "none";
        state.activeLogOrderId = null;
        state.activeLogList = [];
    };

    window.closeEscalationLogModalOnBackdrop = function (e) {
        if (e.target.id === "incwoLogModal" && state.modalMouseDownTarget === e.target) {
            window.closeEscalationLogModal();
        }
        state.modalMouseDownTarget = null;
    };

    // Format escalation log identical to incwo_get_escalation_log_text.js format and copy to clipboard
    window.copyEscalationLogFormatted = function () {
        var logs = state.activeLogList || [];
        if (!logs || logs.length === 0) {
            showToast("No escalation logs to copy.", false);
            return;
        }

        var lines = [];
        logs.forEach(function (item) {
            var rawTime = formatTimeToUTC7(item.create_time || item.time || "");
            var displayTime = rawTime;
            if (rawTime && rawTime.indexOf(" ") !== -1) {
                var parts = rawTime.split(" ");
                var datePart = parts[0] || "";
                var timePart = parts[1] ? parts[1].substring(0, 5) : "";
                displayTime = timePart + " " + datePart;
            }

            var actionText = "";
            var lType = String(item.log_type || item.type || "").toUpperCase();
            var isSupp = (lType === "NEED_SUPPORT" || lType === "SUPPORT");
            if (isSupp) {
                var st = String(item.support_status || item.status || "NEED").toUpperCase();
                actionText = (st === "NEED" || st === "NEED SUPPORT") ? "Set to Need Support" : "Set to No Need Support";
            } else {
                var lvl = item.esc_level !== undefined && item.esc_level !== null ? item.esc_level : (item.level || "0");
                actionText = "Set to Level " + lvl;
            }

            var desc = item.description || item.note || "-";
            var opId = item.operator_id || "";
            var opName = item.operator_name || (item.by !== item.operator_id ? item.by : "") || "";
            var opFull = (opId + " " + opName).trim();
            if (!opFull) opFull = item.by || "Operator";

            lines.push(displayTime + " | " + actionText + " | " + desc + " (Operator " + opFull + ")");
        });

        var fullText = lines.join("\n");

        function onCopySuccess() {
            var btn = document.getElementById("incwoBtnCopyLog");
            if (btn) {
                var origHtml = btn.innerHTML;
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span style="color: #15803d;">Copied!</span>';
                setTimeout(function () {
                    if (btn) btn.innerHTML = origHtml;
                }, 2000);
            }
            showToast("Copied " + lines.length + " escalation log lines to clipboard!", true);
        }

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(fullText).then(onCopySuccess).catch(function () {
                fallbackCopyText(fullText, onCopySuccess);
            });
        } else {
            fallbackCopyText(fullText, onCopySuccess);
        }
    };

    function fallbackCopyText(text, callback) {
        var textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand("copy");
            if (callback) callback();
        } catch (err) {
            console.error("Fallback copy failed", err);
            showToast("Failed to copy to clipboard", false);
        }
        document.body.removeChild(textArea);
    }

    window.saveDetail = function (e) {
        if (e && e.preventDefault) e.preventDefault();

        if (!state.currentDetail) return;
        var orderId = extractOWSField(
            state.currentDetail.orderid || state.currentDetail.id
        );
        var submitBtn = document.getElementById("incwoSaveDetailBtn");
        var picSelect = document.getElementById("incwoDetailPic");

        var selectedResp = "";
        var selectedPicName = "";
        if (picSelect) {
            selectedResp = picSelect.value || "";
            var selectedOpt = picSelect.options[picSelect.selectedIndex];
            selectedPicName = selectedOpt ? (selectedOpt.getAttribute("data-name") || selectedOpt.text || "") : "";
            if (selectedResp === "" && selectedPicName.indexOf("--") !== -1) {
                selectedPicName = "";
            }
        }

        var updatedData = {
            orderid: orderId,
            pic: selectedPicName || (state.currentDetail ? state.currentDetail.pic : "") || "",
            responsibility: selectedResp,
            tt_action: document.getElementById("incwoDetailAction") ? document.getElementById("incwoDetailAction").value : ((state.currentDetail ? state.currentDetail.tt_action : "") || "")
        };

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Checking & Saving...";
        }

        function executeSaveDetailRequest() {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = "Saving...";
            }
            MessageProcessor.process({
                serviceId: SERVICE_UPDATE,
                data: { orderid: orderId, data: updatedData },
                success: function () {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Save Changes";
                    }
                    broadcastTicketSync("MONITOR_TICKET_SAVED", orderId);
                    window.closeDetailModal();
                    showToast("Work order saved successfully!", true);
                    setTimeout(loadTicketList, 500);
                },
                error: function (err) {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = "Save Changes";
                    }
                    showToast("Save failed: " + (err.message || "Unknown error"), false);
                },
            });
        }

        // Pre-Save Live Conflict Check: pastikan data di Process TT belum diubah orang lain selama popup ini terbuka
        fetchTicketDetail(orderId)
            .then(function (latestRes) {
                var latestDetail = (latestRes && latestRes.data) ? latestRes.data : null;
                if (latestDetail && state.initialModalSnapshot && state.initialModalSnapshot.orderid === String(orderId || "").trim().toUpperCase()) {
                    var liveAction = String(extractOWSField(latestDetail.tt_action) || "").trim();
                    var liveResp = String(extractOWSField(latestDetail.responsibility) || "").trim();

                    if (
                        liveAction !== state.initialModalSnapshot.tt_action ||
                        liveResp !== state.initialModalSnapshot.responsibility
                    ) {
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = "Save Changes";
                        }
                        showConflictAlertModal(
                            orderId,
                            "Ticket " + orderId + " was just updated in Process TT while this popup was open! Please close the Process TT page first before overwriting, or proceed if you have closed it.",
                            function () {
                                verifyAndProceedIfProcessTTClosed(orderId, function () {
                                    executeSaveDetailRequest();
                                });
                            }
                        );
                        return;
                    }
                }

                executeSaveDetailRequest();
            })
            .catch(function () {
                // Fallback jika pengecekan gagal karena koneksi sesaat, tetap lanjutkan penyimpanan
                executeSaveDetailRequest();
            });
    };

    // Delete Modal Actions
    window.openDeleteModal = function (orderId) {
        renderDeleteModalDOM();
        state.pendingDeleteId = orderId;
        var label = document.getElementById("incwoPendingDeleteId");
        if (label) label.textContent = orderId;
        var modal = document.getElementById("incwoDeleteModal");
        if (modal) modal.style.display = "flex";
    };

    window.closeDeleteModal = function () {
        var modal = document.getElementById("incwoDeleteModal");
        if (modal) modal.style.display = "none";
        state.pendingDeleteId = null;
    };

    window.closeDeleteModalOnBackdrop = function (e) {
        if (e.target.id === "incwoDeleteModal" && state.modalMouseDownTarget === e.target) {
            window.closeDeleteModal();
        }
        state.modalMouseDownTarget = null;
    };

    window.confirmDeleteTicket = function () {
        if (!state.pendingDeleteId) return;

        var orderId = state.pendingDeleteId;
        var deleteBtn = document.getElementById("incwoConfirmDeleteBtn");
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.textContent = "Deleting...";
        }

        // Soft delete via incwo_incidentticketmonitor_update: active = false
        MessageProcessor.process({
            serviceId: SERVICE_DELETE,
            data: { orderid: orderId, active: false },
            success: function () {
                if (deleteBtn) {
                    deleteBtn.disabled = false;
                    deleteBtn.textContent = "Delete";
                }
                window.closeDeleteModal();
                showToast("Work order deleted successfully!", true);
                setTimeout(loadTicketList, 500);
            },
            error: function (err) {
                if (deleteBtn) {
                    deleteBtn.disabled = false;
                    deleteBtn.textContent = "Delete";
                }
                showToast("Delete failed: " + (err.message || "Unknown error"), false);
            },
        });
    };

    // Inject dynamic CSS animations (avoids ADC Studio CSS validator checking errors on @keyframes)
    function injectDynamicAnimations() {
        if (document.getElementById("incwoKeyframesStyle")) return;
        var styleEl = document.createElement("style");
        styleEl.id = "incwoKeyframesStyle";
        styleEl.textContent =
            "@keyframes needSupportBlink {" +
            "  0%, 3% {" +
            "    background-color: #ffffff;" +
            "    border-color: #ffffff;" +
            "    color: #dc2626;" +
            "  }" +
            "  3.1%, 100% {" +
            "    background-color: #dc2626;" +
            "    border-color: #ef4444;" +
            "    color: #ffffff;" +
            "  }" +
            "}" +
            "@keyframes needSupportTextBlink {" +
            "  0%, 2.5% {" +
            "    color: #ffffff;" +
            "    text-shadow: 0 0 6px rgba(255, 255, 255, 0.8);" +
            "  }" +
            "  2.6%, 100% {" +
            "    color: #f87171;" +
            "    text-shadow: none;" +
            "  }" +
            "}" +
            "@keyframes escDoubleBlinkWhite {" +
            "  0%, 80%, 100% { background-color: #27272a; border-color: #52525b; color: #ffffff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); }" +
            "  83% { background-color: #ffffff; border-color: #ffffff; color: #18181b; box-shadow: 0 0 10px rgba(255, 255, 255, 0.9); }" +
            "  87% { background-color: #27272a; border-color: #52525b; color: #ffffff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); }" +
            "  91% { background-color: #ffffff; border-color: #ffffff; color: #18181b; box-shadow: 0 0 10px rgba(255, 255, 255, 0.9); }" +
            "  95% { background-color: #27272a; border-color: #52525b; color: #ffffff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); }" +
            "}" +
            "@keyframes headerBadgeDoubleBlink {" +
            "  0%, 80%, 87%, 100% { box-shadow: none; filter: none; }" +
            "  83% { background-color: #ffffff !important; border-color: #ffffff !important; box-shadow: 0 0 14px rgba(255, 255, 255, 0.95); filter: brightness(1.6) contrast(1.2); }" +
            "  91% { background-color: #ffffff !important; border-color: #ffffff !important; box-shadow: 0 0 14px rgba(255, 255, 255, 0.95); filter: brightness(1.6) contrast(1.2); }" +
            "}" +
            ".custom-domain-stat-badge.blink-alert.is-flashing * { color: #09090b !important; }";
        document.head.appendChild(styleEl);
    }

    // ==========================================
    // SECTION: EXCEL EXPORT (NATIVE XLSX)
    // ==========================================
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

    window.exportEscalationLogsToExcel = function () {
        var orderId = state.currentDetail ? (state.currentDetail.orderid || state.currentDetail.id || "Ticket") : "Ticket";
        var logs = state.tempEscalationHistory || [];

        if (!logs || logs.length === 0) {
            showToast("No escalation logs to export for this ticket.", false);
            return;
        }

        var btn = document.getElementById("incwoBtnExportLog");
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

            var runningLevel = 0;
            var runningSupp = "NO_NEED";

            if (state.tempEscalationLevel) runningLevel = Number(state.tempEscalationLevel);
            if (state.tempEscalationSupport) runningSupp = state.tempEscalationSupport;

            for (var k = 0; k < logs.length; k++) {
                var lk = logs[k];
                if ((lk.esc_level || lk.level) && !runningLevel) runningLevel = Number(lk.esc_level || lk.level);
                if ((lk.support_status || lk.status) && runningSupp === "NO_NEED") runningSupp = lk.support_status || lk.status;
            }

            var rows = logs.map(function (log, idx) {
                var isSupp = log.log_type === "NEED_SUPPORT" || log.type === "SUPPORT" || (log.support_status && log.esc_level === undefined && log.level === undefined);
                var logTypeLabel = isSupp ? "NEED_SUPPORT" : "ESCALATION_LEVEL";

                if (log.esc_level !== undefined && log.esc_level !== null) {
                    runningLevel = Number(log.esc_level);
                } else if (log.level !== undefined && log.level !== null) {
                    runningLevel = Number(log.level);
                }

                if (log.support_status) {
                    runningSupp = log.support_status;
                } else if (log.status) {
                    runningSupp = log.status;
                }

                var rawLvl = log.esc_level !== undefined && log.esc_level !== null ? log.esc_level : (log.level !== undefined && log.level !== null ? log.level : runningLevel);
                var levelLabel = Number(rawLvl) > 0 ? "Level " + rawLvl : (runningLevel > 0 ? "Level " + runningLevel : "Level 0");

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
            console.error("Export error:", e);
            showToast("Export failed: " + (e.message || "Unknown error"), false);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export Log';
            }
        }
    };

    function init() {
        setupHeaderControls();
        setupFilterSwitcher();
        setupWorkOrderControls();
        renderAddModalDOM();
        renderDetailModalDOM();
        renderDeleteModalDOM();
        renderEscalationModalDOM();
        renderSupportModalDOM();
        renderLogModalDOM();
        renderConflictModalDOM();
        initCrossTabTicketSync();
        injectDynamicAnimations();
        updateClock();
        state.clockTimer = setInterval(updateClock, 1000);

        // Initial Load
        loadTicketList();

        // Auto Refresh every 3 minutes (Silent background update, paused if editing detail modal)
        state.autoRefreshTimer = setInterval(function () {
            var detailModal = document.getElementById("incwoDetailModal");
            if (detailModal && detailModal.style.display === "flex") {
                return;
            }
            loadTicketList(true);
        }, 3 * 60 * 1000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
