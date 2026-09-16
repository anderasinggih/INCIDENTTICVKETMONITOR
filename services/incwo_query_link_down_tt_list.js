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
    let orderid = _message.orderid;
    let keyword = COMMON_UTIL.isNull(orderid) ? "" : String(orderid).trim();
    let domUpper = COMMON_UTIL.isNull(domain) ? "" : String(domain).trim().toUpperCase();

    // 1. Jika user mencari domain PMA atau keyword berawalan PMA
    if (domUpper === "PMA" || keyword.toUpperCase().startsWith("PMA")) {
        let pmaList = getRunningPMATickets(keyword);
        return {
            results: pmaList,
            total: pmaList.length,
            code: 200
        };
    }

    // 2. Jika user memfilter FTTH atau FWA
    if (domUpper === "FTTH" || domUpper === "FWA") {
        let domainCondition = "";
        if (!COMMON_UTIL.isNull(keyword)) {
            domainCondition += ` and tt.orderid like '%${keyword}%'`;
        }
        if (domUpper === "FTTH") {
            domainCondition += ` and (d.name like '%FTTH%')`;
        } else {
            domainCondition += ` and (d.name like '%FWA%')`;
        }
        let ttList = getRunningTickets(domainCondition);
        return {
            results: ttList,
            total: ttList.length,
            code: 200
        };
    }

    // 3. Jika domain tidak dispesifikasikan (ALL): gabungkan running TT dan running PMA
    let ttCondition = "";
    if (!COMMON_UTIL.isNull(keyword)) {
        ttCondition = ` and tt.orderid like '%${keyword}%'`;
    }
    let pmaList = getRunningPMATickets(keyword);
    let ttList = getRunningTickets(ttCondition);
    let combined = pmaList.concat(ttList);

    return {
        results: combined,
        total: combined.length,
        code: 200
    };
}

function getRunningPMATickets(keyword) {
    try {
        let condition = "";
        if (!COMMON_UTIL.isNull(keyword)) {
            condition = ` and (order_id like '%${keyword}%' or title like '%${keyword}%')`;
        }

        let tql = `select order_id as orderid, order_status as ticket_status, title,
            plan_start_time as alarm_time, plan_end_time as clear_time,
            problem_ticket_id, pt_responsibility_party, root_cause, sub_root_cause, link_segment_detail
            from "/ProblemManagementActivity/ProblemManagementActivity/pma_problemmanagementactivity"
            where (order_status like '%running%' or order_status like '%Running%')
            ${condition}
            order by order_id desc
           `;
        let request = {
            start: 0,
            limit: 1000,
            tql: tql,
            parameters: {},
            contains_total: false,
        };

        var response = ServiceInvoker.post(
            "/adc-model/rest/v2/model-instances/query-by-tql",
            request
        );
        if (!COMMON_UTIL.isNull(response.results)) {
            let results = response.results;
            for (let i = 0; i < results.length; i++) {
                results[i].orderid = !COMMON_UTIL.isNull(results[i].orderid) ? String(results[i].orderid).trim() : "";
                results[i].title = !COMMON_UTIL.isNull(results[i].title) ? String(results[i].title).trim() : "";
                results[i].domain = "PMA";
                results[i].tickettype = "PMA";
            }
            return results;
        }
    } catch (e) {
        console.error(PREFIX + " getRunningPMATickets failed: " + e);
    }
    return [];
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
            limit: 1000,
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
