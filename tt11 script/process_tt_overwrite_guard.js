/**
 * OWS Process TT Standalone Script: Cross-Laptop & Cross-Tab Conflict / Overwrite Protection Guard
 * Target File: /Volumes/LVNPC/HUAWEI/PROJECT/Incident Ticket Monitor/tt11 script/process_tt_overwrite_guard.js
 *
 * Place this script separately in the Page Execute Script of Process TT (TT11).
 *
 * How It Works (First-Come, First-Served across Laptops & Tabs):
 * 1. Uses OWS Database (`incwo_incidentticketmonitor` & `inclink_linkdownticketmonitor` via `session_interface` lock metadata) + Browser BroadcastChannel/localStorage.
 * 2. Works both across tabs on the same laptop AND across different laptops/operators!
 * 3. Whoever opens the ticket first holds the priority lock:
 *    - If Incident Ticket Monitor (or another operator's Process TT) opened the ticket first, opening Process TT
 *      holds the form behind a curtain and shows a native OWS Confirmation dialog:
 *      [Cancel] or [Proceed (Overwrite)] (Red button).
 *    - Clicking [Cancel] exits/closes the ticket sub-tab in OWS without entering the ticket form.
 *    - Clicking [Proceed (Overwrite)] takes over the lock in the database and automatically closes the edit popup
 *      in Incident Ticket Monitor (even on another laptop!).
 */

U.ready(function () {
    var SYNC_CHANNEL_NAME = 'ows_inc_ticket_sync_v1';
    var SYNC_STORAGE_KEY = 'ows_inc_ticket_sync_event_v1';
    var LOCK_KEY_PREFIX = 'ows_inc_ticket_lock_v1_';
    var DB_LOCK_TTL_MS = 25000; // Database lock valid up to 25 seconds unless refreshed by session
    var LOCAL_LOCK_TTL_MS = 10 * 60 * 1000;
    var HEARTBEAT_INTERVAL_MS = 10000; // Check DB takeover every 10 seconds (GET only, no repeated UPDATE)

    var SERVICE_INCWO_LOCK_GET = '/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_get';
    var SERVICE_INCWO_LOCK_UPDATE = '/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_update';
    var SERVICE_INCLINK_LOCK_GET = '/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/LinkDownTicketMonitor/inclink_linkdownticketmonitor_get';
    var SERVICE_INCLINK_LOCK_UPDATE = '/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/LinkDownTicketMonitor/inclink_linkdownticketmonitor_update';

    var TAB_ID = window.__owsIncProcessTTTabId || ('ptt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
    window.__owsIncProcessTTTabId = TAB_ID;

    var state = window.__owsIncProcessTTState || {
        orderId: '',
        operatorName: getOperatorName(),
        openedAt: Date.now(),
        forceSeq: 0,
        syncChannel: null,
        heartbeatTimer: null,
        initialSnapshot: null,
        hasConflictWithMonitor: false,
        conflictReasonMessage: '',
        isLockOwner: false,
        allowNextSubmitBypass: false,
        existsInIncwo: false,
        existsInInclink: false,
        busRegistered: false
    };
    window.__owsIncProcessTTState = state;

    function normalizeOrderId(id) {
        return String(id || '').trim().toUpperCase();
    }

    function getOperatorName() {
        try {
            if (typeof _runtime !== 'undefined' && _runtime && _runtime.userName) {
                return String(_runtime.userName).trim();
            }
            if (window.currentUser) return String(window.currentUser).trim();
            if (window.parent && window.parent.currentUser) return String(window.parent.currentUser).trim();
        } catch (e) { }
        return 'Operator';
    }

    function getTicketOrderId() {
        // 1. Check OWS form component S('orderid')
        try {
            if (typeof S === 'function') {
                var compCandidates = ['orderid', 'order_id', 'ticketid', 'ticket_id'];
                for (var i = 0; i < compCandidates.length; i++) {
                    var comp = S(compCandidates[i]);
                    if (comp && comp.getValue) {
                        var val = comp.getValue();
                        if (val && typeof val === 'string' && val.trim().length > 0) {
                            return val.trim();
                        } else if (Array.isArray(val) && val.length > 0) {
                            var itemVal = (val[0].orderid || val[0].id || val[0].value || val[0] || '').toString().trim();
                            if (itemVal) return itemVal;
                        } else if (val && typeof val === 'object') {
                            var objVal = (val.orderid || val.id || val.value || '').toString().trim();
                            if (objVal) return objVal;
                        }
                    }
                }
            }
        } catch (eComp) { }

        // 2. Check URL parameters in window / parent / top
        var urlCandidates = [window.location.href, window.location.search];
        try { if (window.parent) urlCandidates.push(window.parent.location.href, window.parent.location.search); } catch (eP) { }
        try { if (window.top) urlCandidates.push(window.top.location.href, window.top.location.search); } catch (eT) { }

        for (var j = 0; j < urlCandidates.length; j++) {
            var urlStr = urlCandidates[j] || '';
            var m = urlStr.match(/[?&]order_?id=([^&#]+)/i);
            if (m && m[1]) {
                return decodeURIComponent(m[1]).trim();
            }
            var mInc = urlStr.match(/INC-\d{8}-\d+/i);
            if (mInc) {
                return mInc[0].trim();
            }
        }

        // 3. Fallback search in body text
        try {
            var bodyText = document.body ? document.body.innerText : '';
            var matchInc = bodyText.match(/INC-\d{8}-\d+/);
            if (matchInc) {
                return matchInc[0].trim();
            }
        } catch (eDom) { }

        return '';
    }

    // =========================================================================
    // CROSS-LAPTOP (DB) & CROSS-TAB (LOCALSTORAGE) LOCK MANAGER
    // =========================================================================
    function getLockStorageKey(orderId) {
        return LOCK_KEY_PREFIX + normalizeOrderId(orderId);
    }

    function parseLockObject(rawStr, ttlMs) {
        if (!rawStr || typeof rawStr !== 'string') return null;
        var trimmed = rawStr.trim();
        if (trimmed.indexOf('{') !== 0) return null;
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

    function parseLockFromRecord(record, ttlMs) {
        if (!record || typeof record !== 'object') return null;
        return parseLockObject(record.session_interface, ttlMs);
    }

    function readLocalLock(orderId) {
        var normId = normalizeOrderId(orderId);
        if (!normId) return null;
        try {
            var raw = localStorage.getItem(getLockStorageKey(normId));
            return parseLockObject(raw, LOCAL_LOCK_TTL_MS);
        } catch (e) {
            return null;
        }
    }

    function fetchDatabaseLock(orderId, callback) {
        var normId = normalizeOrderId(orderId);
        if (!normId || typeof MessageProcessor === 'undefined' || !MessageProcessor.process) {
            if (callback) callback(null);
            return;
        }
        var services = [];
        if (state.existsInIncwo) {
            services.push(SERVICE_INCWO_LOCK_GET);
        } else if (state.existsInInclink) {
            services.push(SERVICE_INCLINK_LOCK_GET);
        } else {
            services = [SERVICE_INCWO_LOCK_GET, SERVICE_INCLINK_LOCK_GET];
        }
        var pending = services.length;
        var foundLocks = [];

        function onOneDone(lock) {
            if (lock) foundLocks.push(lock);
            pending--;
            if (pending <= 0) {
                if (foundLocks.length === 0) {
                    if (callback) callback(null);
                    return;
                }
                // Pick the lock with highest forceSeq or most recent heartbeat
                foundLocks.sort(function (a, b) {
                    var fa = Number(a.forceSeq || 0);
                    var fb = Number(b.forceSeq || 0);
                    if (fb !== fa) return fb - fa;
                    return Number(b.heartbeatAt || 0) - Number(a.heartbeatAt || 0);
                });
                if (callback) callback(foundLocks[0]);
            }
        }

        for (var i = 0; i < services.length; i++) {
            (function (svc) {
                try {
                    MessageProcessor.process({
                        serviceId: svc,
                        data: { orderid: normId },
                        success: function (res) {
                            var result = (res && res.result) ? res.result : null;
                            if (result && (result.orderid || result.id)) {
                                if (svc === SERVICE_INCWO_LOCK_GET) state.existsInIncwo = true;
                                if (svc === SERVICE_INCLINK_LOCK_GET) state.existsInInclink = true;
                            }
                            onOneDone(parseLockFromRecord(result, DB_LOCK_TTL_MS));
                        },
                        error: function () {
                            onOneDone(null);
                        }
                    });
                } catch (e) {
                    onOneDone(null);
                }
            })(services[i]);
        }
    }

    function getActiveUpdateServices() {
        var list = [];
        if (state.existsInIncwo) list.push(SERVICE_INCWO_LOCK_UPDATE);
        if (state.existsInInclink) list.push(SERVICE_INCLINK_LOCK_UPDATE);
        return list;
    }

    function writeProcessTTLock(orderId, saveToDb) {
        var normId = normalizeOrderId(orderId || state.orderId);
        if (!normId || state.hasConflictWithMonitor) return;
        var lockObj = {
            orderid: normId,
            holder: 'PROCESS_TT',
            tabId: TAB_ID,
            operator: state.operatorName || getOperatorName(),
            openedAt: state.openedAt,
            heartbeatAt: Date.now(),
            forceSeq: Number(state.forceSeq || 0)
        };
        var serialized = JSON.stringify(lockObj);
        try {
            localStorage.setItem(getLockStorageKey(normId), serialized);
            state.isLockOwner = true;
        } catch (e) { }

        if (saveToDb !== false && typeof MessageProcessor !== 'undefined' && MessageProcessor.process) {
            var updateServices = getActiveUpdateServices();
            if (updateServices.length === 0) {
                // Probe DB first so we know which table (incwo vs inclink) owns this ticket before writing
                fetchDatabaseLock(normId, function () {
                    var discoveredServices = getActiveUpdateServices();
                    for (var j = 0; j < discoveredServices.length; j++) {
                        try {
                            MessageProcessor.process({
                                serviceId: discoveredServices[j],
                                data: {
                                    orderid: normId,
                                    session_interface: serialized
                                },
                                success: function () { },
                                error: function () { }
                            });
                        } catch (eDb2) { }
                    }
                });
                return;
            }
            for (var i = 0; i < updateServices.length; i++) {
                try {
                    MessageProcessor.process({
                        serviceId: updateServices[i],
                        data: {
                            orderid: normId,
                            session_interface: serialized
                        },
                        success: function () { },
                        error: function () { }
                    });
                } catch (eDb) { }
            }
        }
    }

    function releaseProcessTTLock(skipDbClear) {
        var normId = normalizeOrderId(state.orderId);
        if (!normId) return;
        var wasOwner = state.isLockOwner;
        try {
            var current = readLocalLock(normId);
            if (current && current.tabId === TAB_ID) {
                localStorage.removeItem(getLockStorageKey(normId));
            }
        } catch (e) { }

        if (wasOwner && skipDbClear !== true && typeof MessageProcessor !== 'undefined' && MessageProcessor.process) {
            var updateServices = getActiveUpdateServices();
            if (updateServices.length === 0) {
                updateServices = [SERVICE_INCWO_LOCK_UPDATE, SERVICE_INCLINK_LOCK_UPDATE];
            }
            for (var i = 0; i < updateServices.length; i++) {
                try {
                    MessageProcessor.process({
                        serviceId: updateServices[i],
                        data: {
                            orderid: normId,
                            session_interface: ''
                        },
                        success: function () { },
                        error: function () { }
                    });
                } catch (eDb) { }
            }
            broadcastSyncSignal('PROCESS_TT_CLOSED', normId);
        }

        state.isLockOwner = false;
        if (state.heartbeatTimer) {
            clearInterval(state.heartbeatTimer);
            state.heartbeatTimer = null;
        }
    }

    function broadcastSyncSignal(type, orderId, extra) {
        var normId = normalizeOrderId(orderId || state.orderId);
        if (!normId) return;

        var payload = {
            type: type,
            orderid: normId,
            source: 'PROCESS_TT',
            tabId: TAB_ID,
            operator: state.operatorName,
            openedAt: state.openedAt,
            forceSeq: state.forceSeq,
            ts: Date.now()
        };
        if (extra && typeof extra === 'object') {
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

    function hideProcessTTConfirmModal() {
        var existingOverlay = document.getElementById('owsIncSyncBlockOverlay');
        if (existingOverlay) {
            existingOverlay.style.display = 'none';
        }
        var existingCurtain = document.getElementById('owsIncSyncFormCurtain');
        if (existingCurtain) {
            existingCurtain.style.display = 'none';
        }
    }

    /**
     * Closes the current TT11 ticket sub-tab inside OWS Portal (or navigates back)
     * WITHOUT closing the main browser tab, and never lets the operator stay inside the ticket form on Cancel.
     */
    function cancelAndExitTicketPage(normId) {
        releaseProcessTTLock();

        // 1. Try OWS SDK sub-tab close methods
        try {
            if (typeof U !== 'undefined') {
                if (typeof U.closeTab === 'function') { U.closeTab(); return; }
                if (typeof U.closeCurrentTab === 'function') { U.closeCurrentTab(); return; }
                if (typeof U.close === 'function') { U.close(); return; }
            }
        } catch (eU) { }

        try {
            if (typeof Spl !== 'undefined') {
                if (Spl.Page && typeof Spl.Page.close === 'function') { Spl.Page.close(); return; }
                if (Spl.Tab && typeof Spl.Tab.closeCurrent === 'function') { Spl.Tab.closeCurrent(); return; }
            }
        } catch (eSpl) { }

        // 2. Try clicking the active sub-tab close (x) button in OWS Portal header
        var parentDocs = [];
        try { if (window.parent && window.parent !== window && window.parent.document) parentDocs.push(window.parent.document); } catch (eP) { }
        try { if (window.top && window.top !== window && window.top.document) parentDocs.push(window.top.document); } catch (eT) { }

        var tabCloseSelectors = [
            '.el-tabs__item.is-active .el-icon-close',
            '.u-tabs-tab-active .u-tabs-close',
            '.u-tab-active .u-tab-close',
            '.nav-tabs > li.active .close',
            '.nav-tabs > li.active .tab-close',
            '.nav-tabs > li.active [class*="close"]',
            '[class*="tab-item"][class*="active"] [class*="close"]',
            '[class*="tab"][class*="active"] .el-icon-close',
            '[class*="tab"][class*="active"] i[class*="close"]',
            'li.active .glyphicon-remove',
            'li.active .fa-times'
        ];

        for (var d = 0; d < parentDocs.length; d++) {
            var pDoc = parentDocs[d];
            for (var s = 0; s < tabCloseSelectors.length; s++) {
                try {
                    var closeIcon = pDoc.querySelector(tabCloseSelectors[s]);
                    if (closeIcon) {
                        closeIcon.click();
                        return;
                    }
                } catch (eSel) { }
            }
        }

        // 3. Try navigating back inside this frame
        try {
            if (window.history && window.history.length > 1) {
                window.history.back();
                return;
            }
        } catch (eHist) { }

        // 4. Fallback: Keep the ticket form completely hidden with a clean Cancelled screen
        var existingOverlay = document.getElementById('owsIncSyncBlockOverlay');
        if (existingOverlay) existingOverlay.style.display = 'none';

        var curtain = document.getElementById('owsIncSyncFormCurtain');
        if (!curtain) {
            curtain = document.createElement('div');
            curtain.id = 'owsIncSyncFormCurtain';
            document.body.appendChild(curtain);
        }
        curtain.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100vh;background:#f0f2f5;z-index:2147483646;display:flex;align-items:center;justify-content:center;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;';
        curtain.innerHTML =
            '<div style="background:#ffffff;border:1px solid #dcdfe6;border-radius:4px;padding:28px 36px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:420px;">' +
            '  <div style="font-size:15px;font-weight:600;color:#303133;margin-bottom:8px;">Ticket Opening Cancelled</div>' +
            '  <div style="font-size:13px;color:#606266;line-height:1.5;margin-bottom:16px;">Ticket <b>' + normId + '</b> is currently being edited in another session. You selected <b>Cancel</b> so this ticket was not opened.</div>' +
            '  <button type="button" id="owsIncReopenChoiceBtn" style="padding:7px 16px;font-size:12px;border-radius:3px;border:1px solid #dcdfe6;background:#ffffff;color:#606266;cursor:pointer;">Show Options Again</button>' +
            '</div>';
        var reopenBtn = document.getElementById('owsIncReopenChoiceBtn');
        if (reopenBtn) {
            reopenBtn.onclick = function () {
                showProcessTTBlockingModal(normId, state.conflictReasonMessage);
            };
        }
    }

    /**
     * Native OWS Confirmation Dialog (no background blur)
     * - Holds the TT11 form behind a solid OWS curtain (#f0f2f5) so the ticket is not entered until Proceed is clicked
     * - [Cancel] (Standard white button): Cancels and exits the ticket page
     * - [Proceed (Overwrite)] (Red button #f56c6c): Takes over the lock and opens the ticket
     */
    function showProcessTTBlockingModal(orderId, customMessage, onOverwriteConfirmed) {
        state.hasConflictWithMonitor = true;
        // Pass true so we do NOT clear the new owner's session_interface in the database!
        releaseProcessTTLock(true);
        var normId = normalizeOrderId(orderId || state.orderId);

        var defaultMsg = customMessage || ('Ticket ' + normId + ' is currently open in Incident Ticket Monitor. Click Cancel to exit, or Proceed (Overwrite) to take over and edit here.');
        state.conflictReasonMessage = defaultMsg;

        // Solid OWS curtain so the ticket form is not visible/accessible until Proceed (Overwrite) is chosen
        var curtain = document.getElementById('owsIncSyncFormCurtain');
        if (!curtain) {
            curtain = document.createElement('div');
            curtain.id = 'owsIncSyncFormCurtain';
            document.body.appendChild(curtain);
        }
        curtain.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100vh;background:#f0f2f5;z-index:2147483645;display:block;';
        curtain.innerHTML = '';

        var existingOverlay = document.getElementById('owsIncSyncBlockOverlay');
        if (existingOverlay) {
            existingOverlay.remove();
        }

        var overlay = document.createElement('div');
        overlay.id = 'owsIncSyncBlockOverlay';
        overlay.style.cssText = [
            'position: fixed',
            'top: 0',
            'bottom: 0',
            'left: 0',
            'right: 0',
            'background: rgba(0, 0, 0, 0.25)',
            'z-index: 2147483647',
            'display: flex',
            'align-items: center',
            'justify-content: center',
            'font-family: "Helvetica Neue", Helvetica, "Microsoft YaHei", Arial, sans-serif'
        ].join(';');

        overlay.innerHTML =
            '<div style="width: 440px; max-width: 92vw; background-color: #ffffff; border-radius: 3px; border: 1px solid #d8dce5; box-shadow: 0 2px 12px 0 rgba(0,0,0,0.18); text-align: left; overflow: hidden;">' +
            '  <div style="padding: 12px 16px; background: #f5f7fa; border-bottom: 1px solid #e4e7ed; display: flex; align-items: center; justify-content: space-between;">' +
            '    <span style="font-size: 14px; font-weight: 700; color: #303133;">Conflict Protection Alert</span>' +
            '    <button type="button" id="owsIncSyncCloseX" aria-label="Close" style="border: none; background: transparent; cursor: pointer; font-size: 14px; color: #909399; padding: 0; line-height: 1;">&#10005;</button>' +
            '  </div>' +
            '  <div style="padding: 20px 18px; color: #303133; font-size: 13px;">' +
            '    <div style="display: flex; align-items: flex-start; gap: 12px;">' +
            '      <div style="width: 22px; height: 22px; border-radius: 50%; background: #e6a23c; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 13px; flex-shrink: 0; margin-top: 1px;">!</div>' +
            '      <div id="owsIncSyncBlockMessage" style="line-height: 1.55; color: #303133; font-size: 13px;">' + defaultMsg + '</div>' +
            '    </div>' +
            '  </div>' +
            '  <div style="padding: 10px 16px; background: #ffffff; border-top: 1px solid #ebeef5; text-align: right; display: flex; justify-content: flex-end; gap: 8px;">' +
            '    <button type="button" id="owsIncSyncCancelBtn" style="line-height: 1; white-space: nowrap; cursor: pointer; background: #ffffff; border: 1px solid #dcdfe6; color: #606266; text-align: center; box-sizing: border-box; outline: none; margin: 0; font-weight: 500; padding: 8px 16px; font-size: 12px; border-radius: 3px;">Cancel</button>' +
            '    <button type="button" id="owsIncSyncOverwriteBtn" style="line-height: 1; white-space: nowrap; cursor: pointer; background: #f56c6c; border: 1px solid #f56c6c; color: #ffffff; text-align: center; box-sizing: border-box; outline: none; margin: 0; font-weight: 600; padding: 8px 16px; font-size: 12px; border-radius: 3px;">Proceed (Overwrite)</button>' +
            '  </div>' +
            '</div>';

        document.body.appendChild(overlay);

        var handleCancel = function () {
            cancelAndExitTicketPage(normId);
        };

        var closeXBtn = document.getElementById('owsIncSyncCloseX');
        if (closeXBtn) closeXBtn.onclick = handleCancel;

        var cancelBtn = document.getElementById('owsIncSyncCancelBtn');
        if (cancelBtn) cancelBtn.onclick = handleCancel;

        var overwriteBtn = document.getElementById('owsIncSyncOverwriteBtn');
        if (overwriteBtn) {
            overwriteBtn.onclick = function () {
                state.hasConflictWithMonitor = false;
                state.openedAt = Date.now();
                state.forceSeq = Date.now(); // Higher sequence so other laptops detect the takeover
                hideProcessTTConfirmModal();
                writeProcessTTLock(normId, true);
                startHeartbeatLoop();

                broadcastSyncSignal('PROCESS_TT_FORCE_OVERWRITE', normId, {
                    openedAt: state.openedAt,
                    forceSeq: state.forceSeq
                });

                if (typeof onOverwriteConfirmed === 'function') {
                    onOverwriteConfirmed();
                }
            };
        }
    }

    function formatHolderSource(lock) {
        if (!lock) return 'another session';
        var where = 'Process TT';
        if (lock.holder === 'INCIDENT_MONITOR') where = 'Incident Ticket Monitor';
        else if (lock.holder === 'LINKDOWN_MONITOR') where = 'Link Down Ticket Monitor';
        var who = lock.operator ? (' by ' + lock.operator) : '';
        return where + who;
    }

    function startHeartbeatLoop() {
        if (state.heartbeatTimer) {
            clearInterval(state.heartbeatTimer);
        }
        state.heartbeatTimer = setInterval(function () {
            // If the Process TT sub-tab or form has been closed/unmounted from OWS DOM, release lock immediately
            if (state.anchorEl && !document.body.contains(state.anchorEl)) {
                releaseProcessTTLock();
                return;
            }

            if (state.hasConflictWithMonitor || !state.orderId) return;

            // Check if Incident/LinkDown Ticket Monitor took over the lock in the database
            fetchDatabaseLock(state.orderId, function (dbLock) {
                if (state.hasConflictWithMonitor) return;
                if (dbLock && dbLock.tabId !== TAB_ID && dbLock.holder !== 'PROCESS_TT') {
                    var dbForce = Number(dbLock.forceSeq || 0);
                    var myForce = Number(state.forceSeq || 0);
                    var dbOpenedEarlier = Number(dbLock.openedAt || 0) < state.openedAt && myForce === 0;

                    if (dbForce > myForce || dbOpenedEarlier) {
                        state.forceSeq = dbForce;
                        showProcessTTBlockingModal(
                            state.orderId,
                            'Ticket ' + state.orderId + ' is currently being edited in ' + formatHolderSource(dbLock) + '. Click Cancel to exit, or Proceed (Overwrite) to take over.'
                        );
                        return;
                    }
                }
                // Refresh localStorage only (no repeated DB _update!)
                writeProcessTTLock(state.orderId, false);
            });
        }, HEARTBEAT_INTERVAL_MS);
    }

    function evaluatePriorityAndClaimLock(orderId) {
        var normId = normalizeOrderId(orderId || state.orderId);
        if (!normId || state.hasConflictWithMonitor) return;

        // 1. Instant check via localStorage (same laptop, only conflict if locked by Monitor)
        var localLock = readLocalLock(normId);
        if (localLock && localLock.tabId !== TAB_ID && localLock.holder !== 'PROCESS_TT' && Number(localLock.openedAt) <= state.openedAt && Number(localLock.forceSeq || 0) >= Number(state.forceSeq || 0)) {
            if (localLock.holder === 'INCIDENT_MONITOR') state.existsInIncwo = true;
            if (localLock.holder === 'LINKDOWN_MONITOR') state.existsInInclink = true;
            // Also probe DB in background so existsInIncwo / existsInInclink is populated if user clicks Proceed (Overwrite)
            fetchDatabaseLock(normId, function () { });
            showProcessTTBlockingModal(
                normId,
                'Ticket ' + normId + ' is already open in ' + formatHolderSource(localLock) + '. Click Cancel to exit, or Proceed (Overwrite) to take over and edit here.'
            );
            return;
        }

        // 2. Live check via OWS Database (only conflict if locked by Incident/LinkDown Ticket Monitor)
        fetchDatabaseLock(normId, function (dbLock) {
            if (state.hasConflictWithMonitor) return;
            if (dbLock && dbLock.tabId !== TAB_ID && dbLock.holder !== 'PROCESS_TT' && (Number(dbLock.openedAt) <= state.openedAt || Number(dbLock.forceSeq || 0) > Number(state.forceSeq || 0))) {
                state.forceSeq = Number(dbLock.forceSeq || 0);
                showProcessTTBlockingModal(
                    normId,
                    'Ticket ' + normId + ' is already open in ' + formatHolderSource(dbLock) + '. Click Cancel to exit, or Proceed (Overwrite) to take over and edit here.'
                );
                return;
            }

            // No prior active Monitor lock -> Process TT claims priority lock
            writeProcessTTLock(normId, true);
            startHeartbeatLoop();
        });
    }

    function handleIncomingSyncEvent(payload) {
        if (!payload || payload.tabId === TAB_ID) return;
        var currentId = normalizeOrderId(state.orderId || getTicketOrderId());
        var incomingId = normalizeOrderId(payload.orderid);
        if (!currentId || !incomingId || currentId !== incomingId) return;

        var monitorLabel = payload.source === 'LINKDOWN_MONITOR' ? 'Link Down Ticket Monitor' : 'Incident Ticket Monitor';
        if (payload.operator) monitorLabel += ' by ' + payload.operator;

        if (payload.type === 'CHECK_PROCESS_TT_ALIVE') {
            // Check whether our DOM container and ticket form are still mounted in OWS
            var liveDomId = normalizeOrderId(getTicketOrderId());
            var isDomAlive = Boolean(liveDomId && liveDomId === currentId);
            if (state.anchorEl && !document.body.contains(state.anchorEl)) {
                isDomAlive = false;
            }
            if (!isDomAlive) {
                releaseProcessTTLock(false);
                return;
            }
            if (!state.hasConflictWithMonitor) {
                broadcastSyncSignal('PROCESS_TT_IS_ALIVE', currentId);
            }
            return;
        }

        if (payload.type === 'MONITOR_TRY_OPEN_POPUP') {
            var monitorOpenedAt = Number(payload.openedAt || Date.now());
            if (!state.hasConflictWithMonitor && state.openedAt <= monitorOpenedAt) {
                writeProcessTTLock(currentId, true);
                broadcastSyncSignal('PROCESS_TT_HAS_PRIORITY', currentId, {
                    openedAt: state.openedAt
                });
            } else {
                showProcessTTBlockingModal(
                    currentId,
                    'Ticket ' + currentId + ' is already open in ' + monitorLabel + '. Click Cancel to exit, or Proceed (Overwrite) to take over and edit here.'
                );
            }
        } else if (payload.type === 'MONITOR_FORCE_OVERWRITE') {
            state.forceSeq = Number(payload.forceSeq || Date.now());
            showProcessTTBlockingModal(
                currentId,
                'Ticket ' + currentId + ' was taken over (Overwrite) in ' + monitorLabel + '. Click Cancel to exit, or Proceed (Overwrite) to take it back.'
            );
        } else if (payload.type === 'MONITOR_TICKET_SAVED') {
            showProcessTTBlockingModal(
                currentId,
                'Ticket ' + currentId + ' was just updated and saved in ' + monitorLabel + '! Click Cancel to exit, or Proceed (Overwrite) to continue with your changes here.'
            );
        }
    }

    function buildSnapshot(data) {
        if (!data) return null;
        return {
            chronology: String(data.incident_chronology || '').trim(),
            responsibility: String(data.responsibility || '').trim(),
            escLevel: Number(data.escalationlevelnumber || 0),
            escSupport: String(data.escalationsupport || 'NO_NEED').trim().toUpperCase()
        };
    }

    function fetchInitialSnapshot(orderId) {
        if (!orderId || orderId.indexOf('PMA-') === 0) return;
        MessageProcessor.process({
            serviceId: '/adc-service/rest/v1/services/TroubleTicket/TroubleTicket/tt_troubleticket_get',
            data: { orderid: orderId },
            success: function (res) {
                if (res && res.result && !state.initialSnapshot) {
                    state.initialSnapshot = buildSnapshot(res.result);
                }
            },
            error: function () { }
        });
    }

    function checkDatabaseForExternalUpdate() {
        if (state.hasConflictWithMonitor) return;
        var orderId = state.orderId || getTicketOrderId();
        if (!orderId || orderId.indexOf('PMA-') === 0) return;

        MessageProcessor.process({
            serviceId: '/adc-service/rest/v1/services/TroubleTicket/TroubleTicket/tt_troubleticket_get',
            data: { orderid: orderId },
            success: function (res) {
                if (res && res.result && state.initialSnapshot) {
                    var latest = buildSnapshot(res.result);
                    var init = state.initialSnapshot;
                    if (
                        latest.chronology !== init.chronology ||
                        latest.responsibility !== init.responsibility ||
                        latest.escLevel !== init.escLevel ||
                        latest.escSupport !== init.escSupport
                    ) {
                        state.initialSnapshot = latest;
                        showProcessTTBlockingModal(
                            orderId,
                            'Ticket ' + orderId + ' was just updated in the database by another session. Click Cancel to exit, or Proceed (Overwrite) to keep editing and overwrite with your data.'
                        );
                    }
                }
            },
            error: function () { }
        });
    }

    function initGuard() {
        var orderId = getTicketOrderId();
        if (!orderId) return;

        var normId = normalizeOrderId(orderId);
        var isFirstInitForTicket = (state.orderId !== normId);
        state.orderId = normId;

        // Track a form DOM element so we can detect when this OWS sub-tab is closed/unmounted
        if (!state.anchorEl || !document.body.contains(state.anchorEl)) {
            var anchor = document.getElementById('Submit') || document.querySelector('[id*="Submit"], [id*="orderid"], .el-form');
            if (anchor) state.anchorEl = anchor;
        }

        if (!window.__owsIncProcessTTSyncReady) {
            window.__owsIncProcessTTSyncReady = true;

            try {
                if (typeof BroadcastChannel !== 'undefined') {
                    state.syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
                    state.syncChannel.onmessage = function (evt) {
                        if (evt && evt.data) {
                            handleIncomingSyncEvent(evt.data);
                        }
                    };
                }
            } catch (eBc) { }

            try {
                window.addEventListener('storage', function (evt) {
                    if (evt && evt.key === SYNC_STORAGE_KEY && evt.newValue) {
                        try {
                            var parsed = JSON.parse(evt.newValue);
                            handleIncomingSyncEvent(parsed);
                        } catch (eJson) { }
                    }
                });
            } catch (eSt) { }

            window.addEventListener('beforeunload', releaseProcessTTLock);
            window.addEventListener('pagehide', releaseProcessTTLock);
            window.addEventListener('unload', releaseProcessTTLock);

            // Hook Submit / Save buttons in Process TT
            setTimeout(function () {
                try {
                    var buttons = document.querySelectorAll('button, #Submit, [id*="Submit"], [id*="Save"], .el-button');
                    buttons.forEach(function (btn) {
                        var text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                        if (btn.id === 'Submit' || text === 'submit' || text === 'save' || text === 'process') {
                            btn.addEventListener('click', function (e) {
                                if (state.allowNextSubmitBypass) {
                                    state.allowNextSubmitBypass = false;
                                    if (state.orderId) {
                                        broadcastSyncSignal('PROCESS_TT_SAVED', state.orderId);
                                    }
                                    return;
                                }
                                if (state.hasConflictWithMonitor) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    showProcessTTBlockingModal(
                                        state.orderId,
                                        state.conflictReasonMessage || ('Ticket ' + state.orderId + ' is currently being edited in another session. Click Cancel to abort, or Proceed (Overwrite) to save anyway.'),
                                        function () {
                                            state.allowNextSubmitBypass = true;
                                            btn.click();
                                        }
                                    );
                                    return false;
                                }
                                if (state.orderId) {
                                    broadcastSyncSignal('PROCESS_TT_SAVED', state.orderId);
                                }
                            }, true);
                        }
                    });
                } catch (eBtn) { }
            }, 1000);
        }

        if (isFirstInitForTicket) {
            evaluatePriorityAndClaimLock(state.orderId);
            fetchInitialSnapshot(state.orderId);
        }
    }

    initGuard();
    setTimeout(initGuard, 600);
    setTimeout(initGuard, 1500);

    if (!state.busRegistered && typeof Spl !== 'undefined' && Spl.EventBus && Spl.EventBus.register) {
        state.busRegistered = true;
        Spl.EventBus.register('orderid', 'value-change', function () {
            var newOrderId = normalizeOrderId(getTicketOrderId());
            if (!newOrderId || newOrderId === state.orderId) {
                // Ignore initial form hydration for the same ticket so we don't reset or conflict with ourselves!
                return;
            }
            releaseProcessTTLock();
            state.openedAt = Date.now();
            state.initialSnapshot = null;
            state.hasConflictWithMonitor = false;
            state.existsInIncwo = false;
            state.existsInInclink = false;
            state.orderId = '';
            setTimeout(initGuard, 200);
        });
    }
});
