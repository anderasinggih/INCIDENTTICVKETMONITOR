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
    let orderid = _message.orderid;
    let incidentChronology = _message.incident_chronology;

    if (COMMON_UTIL.isNull(orderid) || COMMON_UTIL.isNull(incidentChronology)) {
        return { code: 400, message: "Missing orderid or incident_chronology" };
    }

    // 1. Cek apakah tiket ada di watchlist lokal incwo_incidentticketmonitor
    var requestRequest = { orderid: orderid };
    var troubleTicket = ServiceInvoker.post(
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_get",
        requestRequest
    );

    if (COMMON_UTIL.isNull(troubleTicket) || COMMON_UTIL.isNull(troubleTicket.result)) {
        return { code: 404, message: "Ticket not found in watchlist" };
    }

    let ttAction = troubleTicket.result.tt_action;
    if (ttAction != incidentChronology) {
        updateTTInfo(orderid, incidentChronology);
    }

    return { code: 200, message: "Action log updated successfully" };
}

function updateTTInfo(orderId, incidentChronology) {
    try {
        var request = {
            orderid: orderId,
            tt_action: incidentChronology,
        };
        ServiceInvoker.post(
            "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_update",
            request
        );
    } catch (e) {
        console.error(PREFIX + "updateTTInfo Error: " + e.message);
    }
}
