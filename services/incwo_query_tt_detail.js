const PREFIX = `[/${_context.project}/${_context.module}/${_context.serviceName}] `;
const COMMON_UTIL =
    require("/CN_GSC_ID_Surge_Noc_Dashboard/netdrone_maps/commonUtil").commonUtil;

try {
    return main();
} catch (e) {
    console.error(PREFIX + "internal error: " + e);
    return { data: {} };
}

function main() {
    let orderid = _message.orderid;
    var request = { orderid: orderid };

    // Ambil data detail dari tabel lokal incwo_incidentticketmonitor
    var ttInfo = ServiceInvoker.post(
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/IncidentTicketMonitor/incwo_incidentticketmonitor_get",
        request
    ).result;

    if (COMMON_UTIL.isNull(ttInfo)) {
        return { data: {} };
    }

    if (ttInfo.tt_domain != "FTTH") {
        ttInfo["estimated_cp"] = "-";
    }

    return { data: ttInfo };
}
