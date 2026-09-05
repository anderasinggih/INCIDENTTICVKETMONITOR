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
    var request = { orderid: orderid };
    var ttInfo = ServiceInvoker.post(
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_troubleticket_get",
        request
    ).result;
    let inter_station = ttInfo.inter_station;
    if (ttInfo.tt_domain != "DWDM") {
        ttInfo["estimated_cp"] = "-";
    }
    if (inter_station) {
        ttInfo['selectedSegments'] = inter_station.split(",")
    }
    return { data: ttInfo };
}
