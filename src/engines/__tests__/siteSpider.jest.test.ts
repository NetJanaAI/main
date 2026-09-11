import { discoverUrls } from '../siteSpider';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('siteSpider Crawler Engine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return only baseUrl when maxPages is 1', async () => {
        const urls = await discoverUrls('https://example.com', 1);
        expect(urls).toEqual(['https://example.com']);
        expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should discover URLs from sitemap.xml and prioritize intent matching pages', async () => {
        const sitemapXml = `
            <urlset>
                <url><loc>https://example.com/about</loc></url>
                <url><loc>https://example.com/pricing</loc></url>
                <url><loc>https://example.com/procurement-solutions</loc></url>
                <url><loc>https://external-domain.com/page</loc></url>
            </urlset>
        `;

        mockedAxios.get.mockResolvedValueOnce({
            status: 200,
            data: sitemapXml
        });

        const urls = await discoverUrls('https://example.com', 3, 'procurement');

        expect(urls).toContain('https://example.com');
        expect(urls).toContain('https://example.com/procurement-solutions');
        expect(urls).not.toContain('https://external-domain.com/page');
    });

    it('should fallback to BFS crawler when sitemap is missing (404)', async () => {
        // Sitemap 404
        mockedAxios.get.mockRejectedValueOnce(new Error('Request failed with status code 404'));

        // BFS crawl response for home page
        const htmlContent = `
            <html>
                <body>
                    <a href="/services">Services</a>
                    <a href="/contact">Contact Us</a>
                    <a href="https://other.com">External Link</a>
                </body>
            </html>
        `;

        mockedAxios.get.mockResolvedValueOnce({
            status: 200,
            data: htmlContent
        });

        const urls = await discoverUrls('https://example.com', 3, 'services');

        expect(urls).toContain('https://example.com');
        expect(urls).toContain('https://example.com/services');
        expect(urls).toContain('https://example.com/contact');
        expect(urls).not.toContain('https://other.com');
    });
});
