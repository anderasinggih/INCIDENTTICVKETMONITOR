const PREFIX = `[/${_context.project}/${_context.module}/${_context.serviceName}] `;
const COMMON_UTIL =
    require("/CN_GSC_ID_Surge_Noc_Dashboard/netdrone_maps/commonUtil").commonUtil;

try {
    return main();
} catch (e) {
    console.error(PREFIX + "internal error: " + e);
    return { code: 500, message: e.message };
}

function main() {
    let orderid = COMMON_UTIL.isNull(_message.orderid) ? "" : String(_message.orderid).trim();
    let ttInfo = _message.data || {};
    let targetOrderId = COMMON_UTIL.isNull(ttInfo.orderid) ? orderid : String(ttInfo.orderid).trim();

    // Hitung level tertinggi dari new_logs jika ada
    let maxNewLogLevel = 0;
    if (Array.isArray(ttInfo.new_logs) && ttInfo.new_logs.length > 0) {
        ttInfo.new_logs.forEach(function (l) {
            let lType = String(l.log_type || l.type || "").toUpperCase();
            let lvl = Number(l.esc_level !== undefined ? l.esc_level : (l.level !== undefined ? l.level : 0));
            if (lType.indexOf("ESCALATION") !== -1 && !isNaN(lvl) && lvl > maxNewLogLevel) {
                maxNewLogLevel = lvl;
            }
        });
    }

    // 1. UPDATE KE DATA MODEL LOKAL DASHBOARD (incwo_incidentticketmonitor)
    let requestLocal = {
        orderid: targetOrderId,
        pic: ttInfo.pic,
        root_cause: ttInfo.root_cause,
        sub_root_cause: ttInfo.sub_root_cause,
        rca_description: ttInfo.rca_description,
        tt_action: ttInfo.tt_action
    };

    // Ambil data lokal saat ini untuk validasi anti-reset
    let currentLocalLevel = 0;
    try {
        let currentLocal = ServiceInvoker.post(
            "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_get",
            { orderid: targetOrderId }
        );
        if (!COMMON_UTIL.isNull(currentLocal) && !COMMON_UTIL.isNull(currentLocal.result)) {
            let locNum = Number(currentLocal.result.escalationlevelnumber);
            if (!isNaN(locNum) && locNum > currentLocalLevel) {
                currentLocalLevel = locNum;
            }
        }
    } catch (eLoc) {
        console.error(PREFIX + "check current local level error: " + eLoc.message);
    }

    // Sertakan hanya jika ada nilainya agar tidak menimpa data lama di tabel lokal
    if (ttInfo.estimated_cp !== undefined) requestLocal.estimated_cp = ttInfo.estimated_cp;
    if (ttInfo.predictive_etr !== undefined) requestLocal.predictive_etr = ttInfo.predictive_etr;
    if (ttInfo.escalationsupport !== undefined) requestLocal.escalationsupport = ttInfo.escalationsupport;

    // Proteksi anti-reset untuk escalationlevelnumber di tabel lokal:
    // Hanya perbarui jika escalationlevelnumber dikirim secara eksplisit atau ada log baru bertipe escalation
    if (ttInfo.escalationlevelnumber !== undefined || maxNewLogLevel > 0) {
        let inputLevel = Number(ttInfo.escalationlevelnumber || 0);
        let finalLevel = Math.max(inputLevel, maxNewLogLevel, currentLocalLevel);
        if (finalLevel > 0) {
            requestLocal.escalationlevelnumber = finalLevel;
        }
    }

    updateLocalDashboard(requestLocal);

    // 2. SINKRONISASI KE TIKET UTAMA (PMA vs INC)
    let isPMA = targetOrderId.startsWith("PMA-") || orderid.startsWith("PMA-");
    if (isPMA) {
        // Jalur Problem Management Activity (PMA)
        updatePMAActivity(targetOrderId, ttInfo.tt_action);
    } else {
        // Jalur Incident Trouble Ticket (INC)
        var requestRequest = { orderid: orderid };
        var troubleTicket = ServiceInvoker.post(
            "/adc-service/rest/v1/services/TroubleTicket/TroubleTicket/tt_troubleticket_get",
            requestRequest
        );

        if (!COMMON_UTIL.isNull(troubleTicket) && !COMMON_UTIL.isNull(troubleTicket.result)) {
            let incidentChronology = troubleTicket.result.incident_chronology;
            let currentResp = troubleTicket.result.responsibility;
            let targetResp = ttInfo.responsibility;
            let currentLiveLevel = Number(troubleTicket.result.escalationlevelnumber || 0);

            let needUpdate = false;
            let updatePayload = { orderid: orderid };

            if (!COMMON_UTIL.isNull(ttInfo.tt_action) && incidentChronology != ttInfo.tt_action) {
                updatePayload.incident_chronology = ttInfo.tt_action;
                needUpdate = true;
            }

            if (!COMMON_UTIL.isNull(targetResp) && targetResp !== currentResp) {
                updatePayload.responsibility = targetResp;
                needUpdate = true;
            }

            // Proteksi anti-reset untuk escalationlevelnumber di tt_troubleticket:
            // Hanya evaluasi dan update jika escalationlevelnumber dikirim atau ada log eskalasi baru
            if (ttInfo.escalationlevelnumber !== undefined || maxNewLogLevel > 0) {
                let inputLvl = Number(ttInfo.escalationlevelnumber || 0);
                let targetEscLevel = Math.max(inputLvl, maxNewLogLevel, currentLiveLevel);
                if (targetEscLevel > 0 && targetEscLevel > currentLiveLevel) {
                    updatePayload.escalationlevelnumber = targetEscLevel;
                    needUpdate = true;
                }
            }

            if (ttInfo.escalationsupport !== undefined) {
                updatePayload.escalationsupport = ttInfo.escalationsupport;
                needUpdate = true;
            }

            if (needUpdate) {
                updateTroubleTicket(updatePayload);
            }
        }
    }

    // 3. INSERT LOGS KE MODEL BARU incwo_escalation_log
    if (Array.isArray(ttInfo.new_logs) && ttInfo.new_logs.length > 0) {
        insertEscalationLogs(targetOrderId, ttInfo.new_logs);
    }

    return { code: 200, message: "Updated successfully" };
}

// Update ke tabel lokal dashboard
function updateLocalDashboard(request) {
    try {
        ServiceInvoker.post(
            "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_update",
            request
        );
    } catch (e) {
        console.error(PREFIX + "updateLocalDashboard Error: " + e.message);
    }
}

// Sinkronisasi ke tiket utama Incident (incident_chronology dan responsibility jika diubah)
function updateTroubleTicket(payload) {
    try {
        ServiceInvoker.post(
            "/adc-service/rest/v1/services/TroubleTicket/TroubleTicket/tt_troubleticket_update",
            payload
        );
    } catch (e) {
        console.error(PREFIX + "updateTroubleTicket Error: " + e.message);
    }
}

// Sinkronisasi field resolution_notes ke Problem Management Activity (PMA)
function updatePMAActivity(orderId, resolutionNotes) {
    try {
        var request = {
            order_id: String(orderId).trim(),
            resolution_notes: resolutionNotes,
        };
        ServiceInvoker.post(
            "/adc-service/rest/v1/services/ProblemManagementActivity/ProblemManagementActivity/pma_problemmanagementactivity_update",
            request
        );
    } catch (e) {
        console.error(PREFIX + "updatePMAActivity Error: " + e.message);
    }
}

// Insert log riwayat eskalasi & support ke data model incwo_escalation_log
function insertEscalationLogs(orderId, logs) {
    let nowStr = TimeUtil.getUTCString();
    logs.forEach(function (logItem) {
        try {
            let opName = logItem.operator_name || logItem.by || "";
            // Jika ada format "NAMA (aWX1234)", ambil nama murninya saja
            if (opName && opName.indexOf("(") !== -1) {
                opName = opName.split("(")[0].trim();
            }

            let logPayload = {
                orderid: String(orderId).trim(),
                log_type: logItem.log_type || (logItem.type === "SUPPORT" ? "NEED_SUPPORT" : "ESCALATION_LEVEL"),
                esc_level: logItem.esc_level !== undefined ? logItem.esc_level : (logItem.level !== undefined ? logItem.level : null),
                support_status: logItem.support_status || (logItem.status || null),
                description: logItem.description || logItem.note || "",
                operator_id: logItem.operator_id || (typeof _runtime !== "undefined" && _runtime && _runtime.userName ? _runtime.userName : ""),
                operator_name: opName,
                create_time: logItem.create_time || nowStr
            };

            ServiceInvoker.post(
                "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_escalation_log_create",
                logPayload
            );
        } catch (eLog) {
            console.error(PREFIX + "insertEscalationLogs error: " + eLog.message);
        }
    });
}
