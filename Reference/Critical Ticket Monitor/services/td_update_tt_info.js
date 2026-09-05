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
    let ttInfo = _message.data;
    let selectedSegments = ttInfo.selectedSegments;
    let inter_station = ''
    //2.查询tt单的信息，在创建
    if (Array.isArray(selectedSegments) && selectedSegments.length > 0) {
        // 有多选结果数组，可以 .length、.join(',') 等
        inter_station = selectedSegments.join(',');
    } else {
        // 可能是老数据的字符串兜底
        inter_station = selectedSegments;
        console.log(selectedSegments);
    }
    let request = {
        orderid: ttInfo.orderid,
        inter_station: inter_station,
        impact_mpls: ttInfo.impact_mpls,
        pic: ttInfo.pic,
        impact: ttInfo.impact,
        root_cause: ttInfo.root_cause,
        estimated_cp: ttInfo.estimated_cp,
        sub_root_cause: ttInfo.sub_root_cause,
        rca_description: ttInfo.rca_description,
        predictive_etr: ttInfo.predictive_etr,
        tt_action: ttInfo.tt_action,
        selectedSegments: ttInfo.selectedSegments
    };
    updateTicketInfo(request);
    //如果action和tt值不一样，需要修改保持一致
    //先获取tt的值，如果tt值不一样，更新tt的值
    var requestRequest = { orderid: orderid };
    var troubleTicket = ServiceInvoker.post(
        "/adc-service/rest/v1/services/TroubleTicket/TroubleTicket/tt_troubleticket_get",
        requestRequest
    );
    if (COMMON_UTIL.isNull(troubleTicket.result)) {
        return { code: 200 };
    }
    let incidentChronology = troubleTicket.result.incident_chronology;
    let linkSegment = troubleTicket.result.link_segment;
    if (
        incidentChronology != ttInfo.tt_action ||
        linkSegment != inter_station
    ) {
        updateTroubleTicket(orderid, ttInfo.tt_action, inter_station);
    }

    return { code: 200 };
}


function updateTicketInfo(request) {
    try {

        ServiceInvoker.post(
            "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_troubleticket_update",
            request
        );
    } catch (e) {
        console.error(PREFIX + "updateTicketInfo Error:" + e.message);
    }
}

function updateTroubleTicket(orderId, incidentChronology, linkSegment) {
    try {
        var request = {
            orderid: orderId,
            incident_chronology: incidentChronology,
            link_segment: linkSegment,
        };
        ServiceInvoker.post(
            "/adc-service/rest/v1/services/TroubleTicket/TroubleTicket/tt_troubleticket_update",
            request
        );
    } catch (e) {
        console.error(PREFIX + "updateTroubleTicket Error:" + e.message);
    }
}
