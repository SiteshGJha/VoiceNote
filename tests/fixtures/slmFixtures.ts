export interface SlmBenchmarkCase {
  id: string;
  lang: 'en' | 'hi';
  tone: 'professional' | 'casual';
  description: string;
  raw: string;
  expectedReference: string;
  criticalEntities: string[];
}

export const SLM_BENCHMARK_FIXTURES: SlmBenchmarkCase[] = [
  {
    id: 'en_prof_meeting',
    lang: 'en',
    tone: 'professional',
    description: 'English meeting setup with fillers and exact date/time',
    raw: 'Um like we need to schedule a sync with Alice and Bob at 3pm on October 15 to review the budget of $2500.',
    expectedReference: 'We need to schedule a meeting with Alice and Bob at 3pm on October 15 to review the budget of $2500.',
    criticalEntities: ['alice', 'bob', '3pm', '15', '$2500'],
  },
  {
    id: 'en_casual_plans',
    lang: 'en',
    tone: 'casual',
    description: 'English casual memo with informal plans',
    raw: 'Hey so uh maybe we can grab pizza with Rahul around 7pm tonight if you guys are free.',
    expectedReference: 'Hey, maybe we can grab pizza with Rahul around 7pm tonight if you guys are free.',
    criticalEntities: ['rahul', '7pm'],
  },
  {
    id: 'hi_prof_work',
    lang: 'hi',
    tone: 'professional',
    description: 'Hindi work update with exact amounts and dates',
    raw: 'Arre matlab hume kal 10am tak Sharma ji ko ₹5000 ka invoice bhejna hai.',
    expectedReference: 'Hume kal 10am tak Sharma ji ko ₹5000 ka invoice bhejna hai.',
    criticalEntities: ['10am', '₹5000', 'sharma'],
  },
  {
    id: 'hi_casual_chat',
    lang: 'hi',
    tone: 'casual',
    description: 'Hinglish casual update',
    raw: 'Sun na bhai, kal sham ko 6 baje coffee pe milte hain Connaught Place mein.',
    expectedReference: 'Sun na bhai, kal sham ko 6 baje coffee pe milte hain Connaught Place mein.',
    criticalEntities: ['connaught', 'place'],
  },
];
