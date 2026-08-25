/**
 * SOAP client module for the GSRTC reservation API.
 */

export const config = {
  endpoint: 'https://gsrtc.in/GSRTCWSAnd/reservationservice',
  timeoutMs: 12000,
  retries: 1,
};

export class SoapError extends Error {
  constructor(message, status = 502, detail = '') {
    super(message);
    this.name = 'SoapError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Parses simple XML into a JSON object.
 * Handles both single items and arrays (when tags repeat).
 */
function parseXml(xml) {
  if (typeof xml !== 'string') return {};
  
  const result = {};
  const tagRegex = /<([a-zA-Z0-9_:-]+)[^>]*>([\s\S]*?)<\/\1>/g;
  let match;
  let hasMatches = false;
  
  while ((match = tagRegex.exec(xml)) !== null) {
    hasMatches = true;
    let [_, tag, content] = match;
    
    // Strip namespace prefix
    if (tag.includes(':')) tag = tag.split(':')[1];
    
    const hasNested = /<[a-zA-Z0-9_:-]+[^>]*>[\s\S]*?<\/[a-zA-Z0-9_:-]+>/.test(content);
    let parsedContent;
    if (hasNested) {
      parsedContent = parseXml(content);
    } else {
      parsedContent = content.trim()
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    }
    
    if (result[tag] !== undefined) {
      if (!Array.isArray(result[tag])) {
        result[tag] = [result[tag]];
      }
      result[tag].push(parsedContent);
    } else {
      result[tag] = parsedContent;
    }
  }
  
  if (!hasMatches) return xml.trim();
  return result;
}

/**
 * Strips the SOAP envelope and parses the XML response into JSON.
 */
function unwrap(xml, method) {
  const fault = xml.match(/<[a-z0-9_:-]*Fault[^>]*>([\s\S]*?)<\/[a-z0-9_:-]*Fault>/i);
  if (fault) {
    const fs = fault[1].match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
    const detail = fs ? fs[1].trim() : fault[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const status = /invalid|no data|not found|please try/i.test(detail) ? 400 : 502;
    throw new SoapError(detail, status, detail);
  }

  let content = xml;
  const resRegex = new RegExp(`<([a-zA-Z0-9_:-]*${method}Response)[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
  const resMatch = xml.match(resRegex);
  
  if (resMatch) {
    content = resMatch[2];
  }

  const parsed = parseXml(content);
  
  if (parsed && typeof parsed === 'object' && 'return' in parsed) {
    const ret = parsed['return'];
    return Array.isArray(ret) ? ret : [ret];
  }
  
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * POSTs to the SOAP endpoint with retry on transient network/5xx failures.
 */
async function call(method, bodyXml) {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="com.gsrtc.prws.service.bo">
  <soap:Body>
    <ser:${method}>
${bodyXml}
    </ser:${method}>
  </soap:Body>
</soap:Envelope>`;

  let lastError;
  for (let i = 0; i <= config.retries; i += 1) {
    try {
      const res = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Authorization': 'Basic cmFkd3NuaWM6cmFkd3NuaWM=',
          'Accept': '*/*'
        },
        body: envelope,
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      const text = await res.text();
      
      if (!res.ok) {
        try {
          unwrap(text, method);
        } catch (e) {
          if (e instanceof SoapError) throw e;
        }
        const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        throw new SoapError(`${method}: operator returned HTTP ${res.status}`, res.status, snippet);
      }
      
      return unwrap(text, method);
    } catch (e) {
      if (e instanceof SoapError) {
        lastError = e;
      } else {
        lastError = new SoapError(
          e.name === 'TimeoutError' || e.name === 'AbortError'
            ? `${method}: operator timed out` : `${method}: ${e.message}`,
          504
        );
      }
      if (i < config.retries) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastError;
}

/**
 * Fetches PNR details from the SOAP service.
 * @param {string} pnrNo The PNR number to look up
 * @returns {Promise<Array>} Parsed array of PNR details
 */
export function pnrDetails(pnrNo) {
  const body = `      <arg0>
        <counterCode>MBSTC</counterCode>
        <pnrNo>${pnrNo}</pnrNo>
        <vehicleNo>0</vehicleNo>
        <userName>GSANDROID</userName>
      </arg0>`;
  return call('GetPnrDetails', body);
}

/**
 * Fetches ticket tracking history details from the SOAP service.
 * @param {string} pnrNo The PNR number
 * @param {string} mobileNo The associated mobile number
 * @returns {Promise<Array>} Parsed array of ticket details
 */
export function ticketHistory(pnrNo, mobileNo) {
  const body = `      <arg0>
        <counterCode>MBSTC</counterCode>
        <mobileNo>${mobileNo}</mobileNo>
        <pnrNo>${pnrNo}</pnrNo>
        <userName>GSANDROID</userName>
      </arg0>`;
  return call('GetTicketTrackHistoryDetails', body);
}

/**
 * Fetches vehicle number assigned to a trip code from the SOAP service.
 * @param {string} tripCode The trip code to look up
 * @returns {Promise<Array>} Parsed array of vehicle / trip details
 */
export function tripVehicles(tripCode) {
  const body = `      <arg0>
        <counterCode>MBSTC</counterCode>
        <tripCode>${tripCode}</tripCode>
        <userName>GSANDROID</userName>
      </arg0>`;
  return call('GetVechileNosByTripCode', body);
}

/**
 * Fetches pickup point sequence with boarding times for a PNR / trip.
 * @param {object} params { pnrNo, status, tripCode, vehicleNo }
 * @returns {Promise<Array>} Parsed array of pickup point stops
 */
export function pnrPickupPoints({ pnrNo = '0', status = '0', tripCode = '0', vehicleNo = '0' } = {}) {
  const body = `      <arg0>
        <pnrNo>${pnrNo || '0'}</pnrNo>
        <status>${status || '0'}</status>
        <tripCode>${tripCode || '0'}</tripCode>
        <vehicleNo>${vehicleNo || '0'}</vehicleNo>
      </arg0>`;
  return call('GetPickupPointDetailsByPnrNo', body);
}
