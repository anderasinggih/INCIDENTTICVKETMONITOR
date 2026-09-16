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

    // 1. UPDATE KE DATA MODEL LOKAL DASHBOARD (incwo_incidentticketmonitor)
    let requestLocal = {
        orderid: targetOrderId,
        pic: ttInfo.pic,
        root_cause: ttInfo.root_cause,
        sub_root_cause: ttInfo.sub_root_cause,
        rca_description: ttInfo.rca_description,
        tt_action: ttInfo.tt_action
    };

    // Sertakan hanya jika ada nilainya agar tidak menimpa data lama di tabel lokal
    if (ttInfo.estimated_cp !== undefined) requestLocal.estimated_cp = ttInfo.estimated_cp;
    if (ttInfo.predictive_etr !== undefined) requestLocal.predictive_etr = ttInfo.predictive_etr;

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

            if (incidentChronology != ttInfo.tt_action) {
                updateTroubleTicket(orderid, ttInfo.tt_action);
            }
        }
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

// Sinkronisasi HANYA field incident_chronology ke tiket utama Incident
function updateTroubleTicket(orderId, incidentChronology) {
    try {
        var request = {
            orderid: orderId,
            incident_chronology: incidentChronology,
        };
        ServiceInvoker.post(
            "/adc-service/rest/v1/services/TroubleTicket/TroubleTicket/tt_troubleticket_update",
            request
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
