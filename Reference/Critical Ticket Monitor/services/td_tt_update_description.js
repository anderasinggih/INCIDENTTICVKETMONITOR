const PREFIX = `[/${_context.project}/${_context.module}/${_context.serviceName}] `;
const COMMON_UTIL =
    require("/CN_GSC_ID_Surge_Noc_Dashboard/netdrone_maps/commonUtil").commonUtil;

try {
    return main();
} catch (e) {
    console.error(PREFIX + "internal error" + e);
}
function main() {
    //1.查询是否已经存在tt单
    let orderid = _message.orderid;
    let incidentChronology = _message.incident_chronology;
    if (COMMON_UTIL.isNull(orderid) || COMMON_UTIL.isNull(incidentChronology)) {
        return;
    }
    console.error(
        "orderid " + orderid + " createproblemdes :" + incidentChronology
    );
    //如果action和tt值不一样，需要修改保持一致
    var requestRequest = { orderid: orderid };
    var troubleTicket = ServiceInvoker.post(
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_troubleticket_get",
        requestRequest
    );
    if (COMMON_UTIL.isNull(troubleTicket.result)) {
        return;
    }

    let ttAction = troubleTicket.result.tt_action;
    if (ttAction != incidentChronology) {
        updateTTInfo(orderid, incidentChronology);
    }

    return { code: 200 };
}

function updateTTInfo(orderId, incidentChronology) {
    try {
        var request = {
            orderid: orderId,
            tt_action: incidentChronology,
        };
        ServiceInvoker.post(
            "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_troubleticket_update",
            request
        );
    } catch (e) {
        console.error(PREFIX + "updateTTInfo Error:" + e.message);
    }
}
