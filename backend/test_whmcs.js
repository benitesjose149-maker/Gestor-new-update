import 'dotenv/config';
import axios from 'axios';
import { getSecret } from './utils/secrets.js';

const WHMCS_API_URL = getSecret('whmcs_api_url', 'http://cliente.hwperu.com/includes/api.php');
const WHMCS_IDENTIFIER = getSecret('whmcs_identifier', 'Pb55YUTQVfK73P5U1xLu9yF0jbKvZTeq');
const WHMCS_SECRET = getSecret('whmcs_secret', 'hu8U5fQ80TVCHMW4ZBwBR7mYi1Iuw7HR');

async function test() {
    console.log('Testing WHMCS API...');
    console.log('URL:', WHMCS_API_URL);
    console.log('ID:', WHMCS_IDENTIFIER);
    
    const params = new URLSearchParams();
    params.append('identifier', WHMCS_IDENTIFIER);
    params.append('secret', WHMCS_SECRET);
    params.append('action', 'GetInvoice');
    params.append('invoiceid', '11536'); // Just a sample from the image
    params.append('responsetype', 'json');

    try {
        const res = await axios.post(WHMCS_API_URL, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        console.log('Response result:', res.data.result);
        if (res.data.result === 'success') {
            const client = res.data.clientdetails || res.data;
            console.log('Client found:', client.firstname, client.lastname, client.companyname);
        } else {
            console.error('API Error:', res.data.message);
        }
    } catch (err) {
        console.error('Request failed:', err.message);
    }
}

test();
