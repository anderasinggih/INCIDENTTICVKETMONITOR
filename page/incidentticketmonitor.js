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

    // State Management
    var state = {
        currentFilter: "ALL", // "ALL" | "FWA" | "FTTH"
        tickets: [],
        fwaNum: 0,
        ftthNum: 0,
        maxTickets: 8,
        loading: false,
        picList: [],
        runningTickets: [],
        linkSegmentList: [],
        pendingDeleteId: null,
        currentDetail: null,
        selectedSegments: [],
        segmentFilterQuery: "",
        lastUpdatedTime: "-",
        autoRefreshTimer: null,
        clockTimer: null,
        toastTimer: null,
        modalMouseDownTarget: null,
    };

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
        fwaBadge.className = "custom-domain-stat-badge fwa";
        fwaBadge.innerHTML =
            '<span class="custom-domain-stat-label">FWA</span>' +
            '<span class="custom-domain-stat-value" id="incwoStatFwa">' + (state.fwaNum || 0) + '</span>';

        var ftthBadge = document.createElement("div");
        ftthBadge.className = "custom-domain-stat-badge ftth";
        ftthBadge.innerHTML =
            '<span class="custom-domain-stat-label">FTTH</span>' +
            '<span class="custom-domain-stat-value" id="incwoStatFtth">' + (state.ftthNum || 0) + '</span>';

        metricsDiv.appendChild(fwaBadge);
        metricsDiv.appendChild(ftthBadge);

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

        var filters = [
            { key: "ALL", label: "All" },
            { key: "FWA", label: "FWA" },
            { key: "FTTH", label: "FTTH" }
        ];

        filters.forEach(function (f) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "custom-switch-btn" + (state.currentFilter === f.key ? " active" : "");
            btn.textContent = f.label;
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
            addBtn.innerHTML = "<span>+</span><span>Add Work Order</span>";
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
            '          <label class="custom-modal-label">Domain</label>' +
            '          <select class="custom-form-select" id="incwoAddDomain" required>' +
            '            <option value="FWA">FWA</option>' +
            '            <option value="FTTH">FTTH</option>' +
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
            '          <input type="text" class="custom-form-input" id="incwoDetailPic" readonly disabled placeholder="No PIC Assigned" />' +
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
            // Match leading date and/or time pattern
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
        return state.tickets.filter(function (t) {
            var domain = extractOWSField(t.tt_domain || t.domain).toUpperCase();
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

        if (statFwa) statFwa.textContent = state.fwaNum || 0;
        if (statFtth) statFtth.textContent = state.ftthNum || 0;

        var filtered = getFilteredTickets();
        if (countElem) {
            countElem.textContent =
                filtered.length + (filtered.length === 1 ? " ticket" : " tickets");
        }

        var addBtn = document.getElementById("incwoBtnAddWo");
        if (addBtn) {
            addBtn.disabled = state.tickets.length >= state.maxTickets;
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
                '  <div class="custom-wo-empty-title">No Incident Tickets Found</div>' +
                '  <div class="custom-wo-empty-desc">Click "+ Add Work Order" to create or monitor critical tickets.</div>' +
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

            var isFtth = String(domain).toUpperCase().indexOf("FTTH") !== -1;
            var domainBadgeClass = isFtth ? "custom-domain-badge ftth" : "custom-domain-badge fwa";

            var title = extractOWSField(ticket.title) || "-";
            var cm = extractOWSField(ticket.cm_orderid) || "-";
            var interStation = extractOWSField(ticket.inter_station) || "-";
            var alarmTime = extractOWSField(ticket.alarm_time) || "-";
            var clearTime = extractOWSField(ticket.clear_time) || "-";
            var agingTime = extractOWSField(ticket.aging_time) || "-";
            var rcaDesc = extractOWSField(ticket.rca_description) || "-";
            var pic = extractOWSField(ticket.pic) || "-";
            var alarmStatus = extractOWSField(ticket.alarm_status) || "-";
            var rootCause = extractOWSField(ticket.root_cause) || "-";
            var subRootCause = extractOWSField(ticket.sub_root_cause) || "-";
            var predictiveEtr = extractOWSField(ticket.predictive_etr) || "-";
            var estimatedCp = domain === "FTTH" ? (extractOWSField(ticket.estimated_cp) || "-") : "-";
            var action = extractOWSField(ticket.tt_action) || "-";

            html += '<div class="custom-wo-card">';
            html += '  <div class="custom-wo-card-header">';
            html += '    <div class="custom-detail-title-group">';
            html += '      <span class="custom-ticket-id">' + escapeHtml(orderId) + '</span>';
            html += '      <span class="' + domainBadgeClass + '">' + escapeHtml(domain) + '</span>';
            html += '      <span class="custom-status-pill ' + statusClass + '">' + escapeHtml(status) + '</span>';
            html += '    </div>';
            html += '    <div class="custom-wo-header-actions">';
            html += '      <button type="button" class="custom-wo-action-btn btn-delete" title="Delete Work Order" onclick="window.openDeleteModal(\'' + escapeHtml(orderId) + '\')">&#10005;</button>';
            html += '    </div>';
            html += '  </div>';

            html += '  <div class="custom-wo-card-body">';
            html += '    <div class="custom-detail-grid">';
            html += '      <div class="custom-detail-item full-width"><span class="custom-detail-label">Title</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(title) + '</span></div>';
            html += '      <div class="custom-detail-item"><span class="custom-detail-label">CM Order ID</span><span class="custom-detail-sep">:</span><span class="custom-detail-val custom-detail-val-mono">' + escapeHtml(cm) + '</span></div>';
            html += '      <div class="custom-detail-item"><span class="custom-detail-label">PIC Contractor</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(pic) + '</span></div>';
            html += '      <div class="custom-detail-item"><span class="custom-detail-label">Alarm Time</span><span class="custom-detail-sep">:</span><span class="custom-detail-val custom-detail-val-mono">' + escapeHtml(alarmTime) + '</span></div>';
            html += '      <div class="custom-detail-item"><span class="custom-detail-label">Clear Time</span><span class="custom-detail-sep">:</span><span class="custom-detail-val custom-detail-val-mono">' + escapeHtml(clearTime) + '</span></div>';
            html += '      <div class="custom-detail-item"><span class="custom-detail-label">Aging Time</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(agingTime) + '</span></div>';
            html += '      <div class="custom-detail-item"><span class="custom-detail-label">Alarm Status</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(alarmStatus) + '</span></div>';
            html += '      <div class="custom-detail-item"><span class="custom-detail-label">Root Cause</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(rootCause) + '</span></div>';
            html += '      <div class="custom-detail-item"><span class="custom-detail-label">Sub Root Cause</span><span class="custom-detail-sep">:</span><span class="custom-detail-val">' + escapeHtml(subRootCause) + '</span></div>';
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
                setupHeaderControls();
                setupFilterSwitcher();
                setupWorkOrderControls();
                renderAddModalDOM();
                renderDetailModalDOM();
                renderDeleteModalDOM();
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
        setupFilterSwitcher();
        renderWorkOrderCards();
    };

    window.refreshTicketData = function () {
        loadTicketList();
    };

    // Add Modal Actions
    // Fetch running tickets (FWA & FTTH) for Add Modal
    function fetchRunningTickets() {
        return new Promise(function (resolve) {
            MessageProcessor.process({
                serviceId: SERVICE_RUNNING_TT,
                data: {},
                success: function (res) {
                    var list = [];
                    if (Array.isArray(res)) {
                        list = res;
                    } else if (res && Array.isArray(res.results)) {
                        list = res.results;
                    }
                    state.runningTickets = list;
                    resolve(list);
                },
                error: function () {
                    state.runningTickets = [];
                    resolve([]);
                }
            });
        });
    }

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
            var badgeClass = rawDomain.toUpperCase() === "FTTH" ? "custom-autocomplete-badge-ftth" : "custom-autocomplete-badge-fwa";
            var orderId = extractOWSField(t.orderid);
            var title = extractOWSField(t.title);
            var isAdded = existingOrderIds.includes(String(orderId).trim());

            var itemClass = "custom-autocomplete-item" + (isAdded ? " custom-autocomplete-item-added" : "");
            var clickHandler = isAdded
                ? ""
                : ' onclick="window.selectTicketFromDropdown(\'' +
                  escapeHtml(orderId) +
                  "', '" +
                  escapeHtml(rawDomain) +
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
                escapeHtml(rawDomain) +
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
        window.renderTicketDropdown(val);
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
            if (domUpper.indexOf("FTTH") !== -1) {
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
        if (state.tickets.length >= state.maxTickets) {
            showToast("Maximum " + state.maxTickets + " work orders reached. Please delete one first.", false);
            return;
        }

        var modal = document.getElementById("incwoAddModal");
        var domainSelect = document.getElementById("incwoAddDomain");
        var ticketInput = document.getElementById("incwoAddTicketId");
        var dropdown = document.getElementById("incwoAddTicketDropdown");

        if (domainSelect) domainSelect.value = "FWA";
        if (ticketInput) ticketInput.value = "";
        if (dropdown) dropdown.style.display = "none";
        if (modal) modal.style.display = "flex";

        // Preload running tickets for quick selection
        fetchRunningTickets().then(function () {
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
    window.openDetailModal = function (orderId) {
        renderDetailModalDOM();
        var modal = document.getElementById("incwoDetailModal");
        var headerOrderId = document.getElementById("incwoDetailHeaderOrderId");
        if (headerOrderId) headerOrderId.textContent = orderId;

        state.selectedSegments = [];

        Promise.all([
            fetchTicketDetail(orderId),
            fetchPicList(),
        ])
            .then(function (results) {
                var detail = results[0] || {};
                var picList = results[1] || [];

                state.currentDetail = detail;
                state.picList = picList;

                populateDetailModal(detail);
                if (modal) modal.style.display = "flex";
            })
            .catch(function (err) {
                showToast("Failed to fetch detail: " + (err.message || "Unknown error"), false);
            });
    };

    function fetchTicketDetail(orderId) {
        return new Promise(function (resolve, reject) {
            MessageProcessor.process({
                serviceId: SERVICE_DETAIL,
                data: { orderid: orderId },
                success: function (res) {
                    resolve(res.data || {});
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

    function populateDetailModal(detail) {
        var actionElem = document.getElementById("incwoDetailAction");
        if (actionElem) actionElem.value = extractOWSField(detail.tt_action);

        var picElem = document.getElementById("incwoDetailPic");
        if (picElem) {
            picElem.value = extractOWSField(detail.pic) || "No PIC Assigned";
        }
    }

    window.closeDetailModal = function () {
        var modal = document.getElementById("incwoDetailModal");
        if (modal) modal.style.display = "none";
        state.currentDetail = null;
    };

    window.closeDetailModalOnBackdrop = function (e) {
        if (e.target.id === "incwoDetailModal" && state.modalMouseDownTarget === e.target) {
            window.closeDetailModal();
        }
        state.modalMouseDownTarget = null;
    };

    window.saveDetail = function (e) {
        if (e && e.preventDefault) e.preventDefault();

        if (!state.currentDetail) return;
        var orderId = extractOWSField(
            state.currentDetail.orderid || state.currentDetail.id
        );
        var submitBtn = document.getElementById("incwoSaveDetailBtn");

        var updatedData = Object.assign({}, state.currentDetail, {
            orderid: orderId,
            pic: document.getElementById("incwoDetailPic") ? document.getElementById("incwoDetailPic").value : (state.currentDetail.pic || ""),
            tt_action: document.getElementById("incwoDetailAction") ? document.getElementById("incwoDetailAction").value : (state.currentDetail.tt_action || ""),
        });

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

    // Init Component
    function init() {
        setupHeaderControls();
        setupFilterSwitcher();
        setupWorkOrderControls();
        renderAddModalDOM();
        renderDetailModalDOM();
        renderDeleteModalDOM();
        updateClock();
        state.clockTimer = setInterval(updateClock, 1000);

        // Initial Load
        loadTicketList();

        // Auto Refresh every 3 minutes (Silent background update, paused if editing detail modal)
        state.autoRefreshTimer = setInterval(function () {
            var detailModal = document.getElementById("incwoDetailModal");
            if (detailModal && detailModal.style.display === "flex") {
                return; // Jangan refresh kartu jika user sedang asyik ngetik di detail modal
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
