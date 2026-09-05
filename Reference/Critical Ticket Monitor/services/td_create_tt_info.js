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
    let domain = _message.domain;
    domain = domain == "MPLS" ? domain : "DWDM";
    var request = {};
    var response = ServiceInvoker.post(
        "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_troubleticket_get_list",
        request
    );
    if (response.total >= 6) {
        return {
            code: 500,
            error: false,
            message:
                "The number of work orders has already reached 6. Please delete and then add.",
        };
    }
    let orderIds = response.results.map((itme) => itme.orderid);
    if (orderIds.includes(orderid)) {
        return {
            code: 500,
            error: false,
            message: "orderid: " + orderid + " already exists in the list",
        };
    }
    //2.查询tt单的信息，在创建

    let ttInfo = getTTInfo(orderid);

    if (COMMON_UTIL.isNull(ttInfo)) {
        return {
            code: 500,
            error: false,
            message:
                "The ticket type is empty, or the ticket status is not running. Kindly review the ticket."
        };
    }
    if (!COMMON_UTIL.isNull(ttInfo.domain) && ttInfo.domain != domain) {
        return {
            code: 500,
            error: false,
            message:
                "orderid: " +
                orderid +
                " domain is " +
                ttInfo.domain +
                " is not " +
                domain,
        };
    }

    let associateorderid = ttInfo.associateorderid;
    let cm_orderid = "";
    let impactMpls = "";
    let createTime = TimeUtil.getUTCString();
    if (!COMMON_UTIL.isNull(associateorderid)) {
        let orderIdArr = associateorderid.split(";");
        let ttIdArr = [];
        let cmIdArr = [];
        for (let i = 0; i < orderIdArr.length; i++) {
            if (orderIdArr[i].indexOf("CM") != -1) {
                cmIdArr.push(orderIdArr[i]);
            } else if (orderIdArr[i].indexOf("INC") != -1) {
                ttIdArr.push(orderIdArr[i]);
            }
        }
        if (!COMMON_UTIL.isNull(cmIdArr)) {
            cm_orderid = cmIdArr.join(";");
        }
        if (!COMMON_UTIL.isNull(ttIdArr)) {
            impactMpls = getAssociateInfo(ttIdArr);
        }
    }

    let list = [];
    if (!COMMON_UTIL.isNull(ttInfo)) {
        var requestInfo = {
            orderid: ttInfo.orderid,
            title: ttInfo.title,
            cm_orderid: cm_orderid,
            start_time: ttInfo.createtime,
            impact_mpls: impactMpls,
            pic: "",
            alarm_time: ttInfo.alarm_time,
            clear_time: ttInfo.clear_time,
            root_cause: ttInfo.root_cause,
            sub_root_cause: ttInfo.sub_root_cause,
            inter_station: ttInfo.link_segment,
            rca_description: ttInfo.initial_rca,
            estimated_cp: ttInfo.estimated_cp,
            tt_domain: domain,
            ticket_status: ttInfo.ticket_status,
            active: true,
            tt_action: ttInfo.tt_action,
            create_time: createTime,
        };
        list.push(requestInfo);
        let request = {
            _values: list,
        };
        // return request
        let response = ServiceInvoker.post(
            "/adc-service/rest/v1/services/CN_GSC_ID_Surge_Noc_Dashboard/ticket_dashboard/td_troubleticket_batch_upsert",
            request
        );
    }

    return { code: 200, response: response };
}

function getTTInfo(orderid) {

    let tql = `select orderid,tickettype,ticketstatus as ticket_status,title, associateorderid,createtime,createfaultfirstoccurtime as alarm_time,
            faultresolvingtime as clear_time,root_cause,sub_root_cause,link_segment,initial_rca,estimated_cp,incident_chronology as tt_action,d.name as domain
            from "/TroubleTicket/TroubleTicket/tt_troubleticket" as tt
            left join "/datahub/cmdb/cmdb_domain" d on d.id=tt.domain 
            where  orderid = $orderid  and ticketstatus ='running'  and tt.tickettype ='Link Down'
            order by orderid desc
           `;
    let request = {
        start: 0,
        limit: 1000,
        tql: tql,
        parameters: {
            orderid: orderid
        },
        contains_total: false,
    };
    try {
        var response = ServiceInvoker.post(
            "/adc-model/rest/v2/model-instances/query-by-tql",
            request
        );
        if (!COMMON_UTIL.isNull(response.results)) {
            return response.results[0];
        }
    } catch (e) {
        console.error(PREFIX + " getTTEmsAlarmNo failed. " + e);
    }
    return [];
}

function getAssociateInfo(orderIdArr) {
    let associateInfo = "";
    let list = [];
    let tql = `select orderid,tickettype,ticketstatus as ticket_status,fl.label as faultlevel,link_segment
            from "/TroubleTicket/TroubleTicket/tt_troubleticket" as tt
            left join "/datahub/cmdb/cmdb_fault_level" as fl  on tt.faultlevel=fl.id
            where  orderid in $orderIdArr
           `;
    let request = {
        start: 0,
        limit: 1000,
        tql: tql,
        parameters: {
            orderIdArr: orderIdArr,
        },
        contains_total: false,
    };
    try {
        var response = ServiceInvoker.post(
            "/adc-model/rest/v2/model-instances/query-by-tql",
            request
        );
        if (!COMMON_UTIL.isNull(response.results)) {
            list = response.results;
        }
    } catch (e) {
        console.error(PREFIX + " getTTEmsAlarmNo failed. " + e);
    }

    for (let i = 0; i < list.length; i++) {
        let info = list[i];
        associateInfo =
            associateInfo +
            info.orderid +
            "[" +
            info.ticket_status +
            "]" +
            "[" +
            info.faultlevel +
            "]" +
            "Link Down MPLS" +
            (COMMON_UTIL.isNull(info.link_segment) ? " " : info.link_segment) +
            " ";
    }
    return associateInfo;
}
