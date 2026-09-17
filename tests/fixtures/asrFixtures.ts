export interface AsrBenchmarkSample {
  id: string;
  lang: 'en' | 'hi';
  description: string;
  reference: string;
  hypothesis: string;
  durationMs: number;
}

export const ASR_BENCHMARK_FIXTURES: AsrBenchmarkSample[] = [
  {
    id: 'en_sample_1',
    lang: 'en',
    description: 'Clean English professional meeting note',
    reference: 'Let us schedule the sprint planning meeting for tomorrow morning at ten.',
    hypothesis: 'Let us schedule the sprint planning meeting for tomorrow morning at ten.',
    durationMs: 3200,
  },
  {
    id: 'en_sample_2',
    lang: 'en',
    description: 'Short English voice memo',
    reference: 'Please review the offline model download documentation before merging.',
    hypothesis: 'Please review the offline model download documentation before merging.',
    durationMs: 2800,
  },
  {
    id: 'hi_sample_1',
    lang: 'hi',
    description: 'Standard Hindi conversational utterance',
    reference: 'यह एक बहुत ही महत्वपूर्ण ऑफलाइन वॉइस नोट है।',
    hypothesis: 'यह एक बहुत ही महत्वपूर्ण ऑफलाइन वॉइस नोट है।',
    durationMs: 2500,
  },
  {
    id: 'hi_sample_2',
    lang: 'hi',
    description: 'Hindi work update note',
    reference: 'कल सुबह दस बजे टीम के साथ मीटिंग निर्धारित की गई है।',
    hypothesis: 'कल सुबह दस बजे टीम के साथ मीटिंग निर्धारित की गई है।',
    durationMs: 3100,
  },
];
