export function parseBankEmail(subject, body, from, date) {
    const fromLower = (from || '').toLowerCase();
    const subjectLower = (subject || '').toLowerCase();
    const text = `${subject || ''}\n${body || ''}`;

    const parsers = [
        { check: () => isYapeEmail(fromLower, subjectLower, text), parse: () => parseYape(text, date) },
        { check: () => isPlinEmail(fromLower, subjectLower, text), parse: () => parsePlin(text, date) },
        { check: () => isBcpEmail(fromLower, subjectLower), parse: () => parseBcp(text, date) },
        { check: () => isInterbankEmail(fromLower, subjectLower), parse: () => parseInterbank(text, date) },
    ];

    for (const parser of parsers) {
        if (parser.check()) {
            const result = parser.parse();
            if (result && result.monto > 0) {
                return result;
            }
        }
    }

    return null;
}

function isYapeEmail(from, subject, text) {
    return from.includes('yape') || subject.includes('yape') || text.toLowerCase().includes('yapeas');
}

function isPlinEmail(from, subject, text) {
    return from.includes('plin') || subject.includes('plin') || text.toLowerCase().includes('plin');
}

function isBcpEmail(from, subject) {
    return from.includes('bcp') || from.includes('viabcp') ||
        subject.includes('bcp') || subject.includes('viabcp') ||
        from.includes('notificacionesbcp');
}

function isInterbankEmail(from, subject) {
    return from.includes('interbank') || subject.includes('interbank') ||
        from.includes('intercorp');
}

function parseYape(text, date) {
    const montoMatch = text.match(/(?:yapeaste|pago\s+con\s+yape\s+por|yape\s+de)\s*S\/?\s*([\d,]+\.?\d*)/i)
        || text.match(/S\/?\s*([\d,]+\.?\d*)/i);

    if (!montoMatch) return null;

    const monto = parseFloat(montoMatch[1].replace(/,/g, ''));

    const isIncoming = /te\s+yapear|recibiste|te\s+envi/i.test(text);
    if (isIncoming) return null;

    let comercio = 'Yape';
    const comercioMatch = text.match(/(?:yapeaste\s+.*?a\s+|en\s+)([A-ZÁÉÍÓÚÑa-záéíóúñ\s\d\.]+)/i);
    if (comercioMatch) {
        comercio = comercioMatch[1].trim().substring(0, 200);
    }

    return {
        monto,
        banco: 'YAPE',
        tipoEgreso: 'YAPE',
        comercio,
        fecha: date || new Date().toISOString(),
        origen: 'GMAIL'
    };
}

function parsePlin(text, date) {
    const montoMatch = text.match(/(?:plin|transferencia)\s*(?:por|:)?\s*S\/?\s*([\d,]+\.?\d*)/i)
        || text.match(/S\/?\s*([\d,]+\.?\d*)/i);

    if (!montoMatch) return null;

    const monto = parseFloat(montoMatch[1].replace(/,/g, ''));
    const isIncoming = /recibiste|te\s+envi/i.test(text);
    if (isIncoming) return null;

    let comercio = 'Plin';
    const comercioMatch = text.match(/(?:a\s+|para\s+)([A-ZÁÉÍÓÚÑa-záéíóúñ\s\d\.]+)/i);
    if (comercioMatch) {
        comercio = comercioMatch[1].trim().substring(0, 200);
    }

    return {
        monto,
        banco: 'PLIN',
        tipoEgreso: 'PLIN',
        comercio,
        fecha: date || new Date().toISOString(),
        origen: 'GMAIL'
    };
}

function parseBcp(text, date) {
    // BCP patterns:
    const montoMatch = text.match(/(?:consumo|compra|pago|transferencia|operaci[oó]n)\s*.*?(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i)
        || text.match(/por\s+(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i)
        || text.match(/(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i);

    if (!montoMatch) return null;

    const monto = parseFloat(montoMatch[1].replace(/,/g, ''));

    let tipoEgreso = 'TRANSFERENCIA';
    if (/tarjeta|t\.c\.|tc\b/i.test(text)) tipoEgreso = 'TARJETA';
    if (/yape/i.test(text)) tipoEgreso = 'YAPE';

    let comercio = 'BCP';

    const regex1 = /en\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s\.\-\*\&]+?)(?:\.|\n|\r|\s+por|\s+el\b)/i;
    const regex2 = /(?:a\s+favor\s+de|para)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s\.\-\*\&]+?)(?:\.|\n|\r)/i;

    const m1 = text.match(regex1);
    const m2 = text.match(regex2);

    let tempComercio = '';
    if (m1 && m1[1]) tempComercio = m1[1].trim();
    else if (m2 && m2[1]) tempComercio = m2[1].trim();

    const lowerTmp = tempComercio.toLowerCase();
    if (tempComercio.length > 1 &&
        !lowerTmp.includes('un plazo') &&
        !lowerTmp.includes('sorteos') &&
        lowerTmp !== 'name' &&
        lowerTmp !== 'ti' &&
        lowerTmp !== 'tu cuenta') {
        comercio = tempComercio.substring(0, 200);
    } else {
        const fallback = text.match(/(?:Empresa|Comercio)\s*:\s*([^\n\r]+)/i);
        if (fallback) comercio = fallback[1].trim().substring(0, 200);
    }

    return {
        monto,
        banco: 'BCP',
        tipoEgreso,
        comercio,
        fecha: date || new Date().toISOString(),
        origen: 'GMAIL'
    };
}

function parseInterbank(text, date) {
    const montoMatch = text.match(/(?:consumo|compra|pago|transferencia|operaci[oó]n)\s*.*?(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i)
        || text.match(/por\s+(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i)
        || text.match(/(?:S\/?|US\$|USD|\$)\s*([\d,]+\.?\d*)/i);

    if (!montoMatch) return null;

    const monto = parseFloat(montoMatch[1].replace(/,/g, ''));

    let tipoEgreso = 'TRANSFERENCIA';
    if (/tarjeta|t\.c\.|tc\b/i.test(text)) tipoEgreso = 'TARJETA';
    if (/yape/i.test(text)) tipoEgreso = 'YAPE';

    let comercio = 'Interbank';
    const comercioMatch = text.match(/(?:en\s+)([A-ZÁÉÍÓÚÑa-záéíóúñ\s\d\.\-\*]+?)(?:\s+por|\s+el|\s*$)/i);
    if (comercioMatch) {
        comercio = comercioMatch[1].trim().substring(0, 200);
    }

    return {
        monto,
        banco: 'INTERBANK',
        tipoEgreso,
        comercio,
        fecha: date || new Date().toISOString(),
        origen: 'GMAIL'
    };
}

/**
 * Extract plain text from Gmail message body.
 * Handles both base64url and HTML bodies.
 */
export function extractTextFromMessage(message) {
    const payload = message.payload;
    if (!payload) return '';

    // Simple plain text
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
        return decodeBase64Url(payload.body.data);
    }

    // Multipart — look for text/plain part
    if (payload.parts) {
        for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
                return decodeBase64Url(part.body.data);
            }
            // Nested multipart
            if (part.parts) {
                for (const subPart of part.parts) {
                    if (subPart.mimeType === 'text/plain' && subPart.body?.data) {
                        return decodeBase64Url(subPart.body.data);
                    }
                }
            }
        }
        // Fallback: try HTML and strip tags
        for (const part of payload.parts) {
            if (part.mimeType === 'text/html' && part.body?.data) {
                const html = decodeBase64Url(part.body.data);
                return stripHtml(html);
            }
        }
    }

    // Direct HTML body
    if (payload.body?.data) {
        const html = decodeBase64Url(payload.body.data);
        return stripHtml(html);
    }

    return '';
}

function decodeBase64Url(data) {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
}

function stripHtml(html) {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
