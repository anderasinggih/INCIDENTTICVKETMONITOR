const PREFIX = `[/${_context.project}/${_context.module}/${_context.serviceName}] `;
const COMMON_UTIL =
    require("/CN_GSC_ID_Surge_Noc_Dashboard/netdrone_maps/commonUtil").commonUtil;

try {
    return main();
} catch (e) {
    console.error(PREFIX + "internal error: " + e);
    return { results: [], total: 0, code: 500, message: e.message };
}

function main() {
    let domain = _message.domain;
    let domainCondition = "";

    if (!COMMON_UTIL.isNull(domain) && domain === "FTTH") {
        domainCondition = ` and (d.name = 'FTTH' or d.name like '%FTTH%')`;
    } else if (!COMMON_UTIL.isNull(domain) && domain === "FWA") {
        domainCondition = ` and (d.name = 'FWA' or d.name like '%FWA%')`;
    } else {
        domainCondition = ` and (d.name like '%FWA%' or d.name like '%FTTH%')`;
    }

    let ttList = getRunningTickets(domainCondition);
    return {
        results: ttList,
        total: ttList.length,
        code: 200
    };
}

function getRunningTickets(domainCondition) {
    try {
        let tql = `select orderid, tickettype, ticketstatus as ticket_status, title,
            createtime, createfaultfirstoccurtime as alarm_time,
            faultresolvingtime as clear_time, root_cause, sub_root_cause, d.name as domain
            from "/TroubleTicket/TroubleTicket/tt_troubleticket" as tt
            left join "/datahub/cmdb/cmdb_domain" as d on d.id = tt.domain 
            where ticketstatus = 'running' 
            ${domainCondition} 
            order by orderid desc
           `;
        let request = {
            start: 0,
            limit: 100,
            tql: tql,
            parameters: {},
            contains_total: false,
        };

        var response = ServiceInvoker.post(
            "/adc-model/rest/v2/model-instances/query-by-tql",
            request
        );
        if (!COMMON_UTIL.isNull(response.results)) {
            return response.results;
        }
    } catch (e) {
        console.error(PREFIX + " getRunningTickets failed: " + e);
    }
    return [];
}
