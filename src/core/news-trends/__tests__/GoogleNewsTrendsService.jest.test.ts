import { GoogleNewsTrendsService } from '../GoogleNewsTrendsService';
import { ChunkingPipeline } from '../../rag/ChunkingPipeline';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GoogleNewsTrendsService & News Intelligence Pipeline', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Article Sentiment and Categorization', () => {
        test('1. Correctly classifies regulatory and risk keywords', () => {
            const res = GoogleNewsTrendsService.classifyArticle(
                'SEBI initiates probe into company governance lapses',
                'The regulatory authority served notice regarding financial violations.'
            );
            expect(res.category).toBe('REGULATORY_RISK');
            expect(res.sentiment).toBe('NEGATIVE');
        });

        test('2. Correctly classifies growth and expansion keywords', () => {
            const res = GoogleNewsTrendsService.classifyArticle(
                'Infosys announces major cloud expansion deal worth $1.5B',
                'Strategic partnership to accelerate enterprise digital transformation.'
            );
            expect(res.category).toBe('GROWTH');
            expect(res.sentiment).toBe('POSITIVE');
        });

        test('3. Correctly classifies quarterly financial reports', () => {
            const res = GoogleNewsTrendsService.classifyArticle(
                'Q4 financial results show robust EBITDA margins and dividend',
                'Net profit increased by 14% year over year with dividend declared.'
            );
            expect(res.category).toBe('FINANCIAL');
            expect(res.sentiment).toBe('POSITIVE');
        });

        test('4. Correctly classifies leadership appointments', () => {
            const res = GoogleNewsTrendsService.classifyArticle(
                'Board appoints new Chief Executive Officer and MD',
                'The board of directors approved the leadership succession roadmap.'
            );
            expect(res.category).toBe('LEADERSHIP');
            expect(res.sentiment).toBe('NEUTRAL');
        });
    });

    describe('Google News RSS XML Ingestion', () => {
        test('5. Successfully parses Google News XML into structured articles', async () => {
            const mockRssXml = `<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0">
                <channel>
                    <title>"Infosys" - Google News</title>
                    <item>
                        <title>Infosys Wins $2 Billion Digital Transformation Deal - Economic Times</title>
                        <link>https://news.google.com/rss/articles/CBMiRGh0dHBzOi8v...</link>
                        <pubDate>Fri, 12 Sep 2026 06:30:00 GMT</pubDate>
                        <description>&lt;a href="..."&gt;Infosys expands enterprise cloud footprint across Europe.&lt;/a&gt;</description>
                        <source url="https://economictimes.indiatimes.com">Economic Times</source>
                    </item>
                    <item>
                        <title>Court directs company to settle vendor arbitration claim - Livemint</title>
                        <link>https://news.google.com/rss/articles/CBMiR...2</link>
                        <pubDate>Thu, 11 Sep 2026 12:00:00 GMT</pubDate>
                        <description>Commercial court hearing held on pending contractual obligations.</description>
                        <source url="https://www.livemint.com">Livemint</source>
                    </item>
                </channel>
            </rss>`;

            mockedAxios.get.mockResolvedValueOnce({ data: mockRssXml });

            const articles = await GoogleNewsTrendsService.fetchCompanyNews('Infosys Limited', 5);

            expect(articles.length).toBe(2);
            expect(articles[0].sourceName).toBe('Economic Times');
            expect(articles[0].category).toBe('GROWTH');
            expect(articles[0].sentiment).toBe('POSITIVE');
            expect(articles[0].title).toBe('Infosys Wins $2 Billion Digital Transformation Deal'); // Stripped trailing source

            expect(articles[1].sourceName).toBe('Livemint');
            expect(articles[1].category).toBe('REGULATORY_RISK');
            expect(articles[1].sentiment).toBe('NEGATIVE');
        });

        test('6. Falls back to default fallback news on network failure without throwing', async () => {
            mockedAxios.get.mockRejectedValueOnce(new Error('Network connection timeout'));

            const articles = await GoogleNewsTrendsService.fetchCompanyNews('Tata Motors', 5);
            expect(articles.length).toBeGreaterThan(0);
            expect(articles[0].title).toContain('Tata Motors');
        });
    });

    describe('Google Trends Synthesis', () => {
        test('7. Generates 30-day timeline series and momentum metric', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: `)]}',\n{"default":{"topics":[{"title":"Infosys","type":"IT services company","mid":"/m/01k8x6"}]}}`
            });

            const trends = await GoogleNewsTrendsService.fetchSearchTrends('Infosys');

            expect(trends.query).toBe('Infosys');
            expect(trends.dataPoints.length).toBe(30);
            expect(trends.momentumScore).toBeGreaterThanOrEqual(10);
            expect(trends.momentumScore).toBeLessThanOrEqual(100);
            expect(['SPIKING', 'HIGH_MOMENTUM', 'STEADY', 'COOLING']).toContain(trends.velocityLabel);
            expect(trends.topSearchQueries.length).toBeGreaterThan(0);
            expect(trends.relatedTopics.length).toBe(1);
            expect(trends.relatedTopics[0].title).toBe('Infosys');
        });
    });

    describe('RAG Chunking Pipeline Integration', () => {
        test('8. Chunks news articles into vector-ready RAG chunks with metadata', () => {
            const sampleArticles = [
                {
                    title: 'Wipro Expands Cyber Security Operations in Bengaluru',
                    sourceName: 'Business Standard',
                    pubDate: '2026-09-12T00:00:00.000Z',
                    snippet: 'State of the art operations center inaugurated to serve enterprise clients.',
                    link: 'https://news.google.com/sample',
                    category: 'GROWTH',
                    sentiment: 'POSITIVE'
                }
            ];

            const chunks = ChunkingPipeline.chunkNews('Wipro Limited', 'ent_wipro_123', sampleArticles);

            expect(chunks.length).toBe(1);
            expect(chunks[0].section).toBe('NEWS');
            expect(chunks[0].content).toContain('[LIVE GOOGLE NEWS & MARKET RADAR - Wipro Limited]');
            expect(chunks[0].content).toContain('Headline: Wipro Expands Cyber Security Operations in Bengaluru');
            expect(chunks[0].content).toContain('Market Sentiment: POSITIVE');
            expect(chunks[0].metadata.entityId).toBe('ent_wipro_123');
            expect(chunks[0].metadata.category).toBe('GROWTH');
        });
    });
});
