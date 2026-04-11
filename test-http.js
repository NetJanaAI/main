const http = require('http');

const companyClass = "TECH_CORP_TEST_DIRECT";

const payload1 = JSON.stringify({
    company_name: companyClass,
    funding_amount: "$20M",
    funding_round: "Series B",
    announcement_date: new Date().toISOString(),
    headquarters: "Bengaluru, Karnataka",
    investors: "Sequoia"
});

const req1 = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/ingest/funding',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload1)
    }
}, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
        console.log('Signal 1 Sent:', data);

        // Send signal 2
        setTimeout(() => {
            const payload2 = JSON.stringify({
                company_name: companyClass,
                job_title: 'Head of Procurement',
                job_location: 'Bengaluru, Karnataka',
                posted_date: new Date().toISOString(),
                job_description: 'We need someone to manage our 50Cr budget.'
            });

            const req2 = http.request({
                hostname: 'localhost',
                port: 3000,
                path: '/api/ingest/naukri',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload2)
                }
            }, res2 => {
                let data2 = '';
                res2.on('data', chunk => { data2 += chunk; });
                res2.on('end', () => {
                    console.log('Signal 2 Sent:', data2);
                });
            });
            req2.write(payload2);
            req2.end();
        }, 3000);
    });
});

req1.write(payload1);
req1.end();
