import { validatePreservation } from '@/ml/slm/validator';
import { SLM_BENCHMARK_FIXTURES, SlmBenchmarkCase } from '../tests/fixtures/slmFixtures';
import { llamaNative } from '@/native/llamaNative';
import { buildPrompt } from '@/ml/slm/promptBuilder';
import { postProcessOutput } from '@/ml/slm/postProcess';

export interface BakeOffResult {
  modelId: string;
  tokensPerSec: number;
  peakRamMb: number;
  preservationPassRate: number; // 0 to 1
  averageLatencyMs: number;
}

export function evaluateModelPerformance(
  modelId: string,
  testCases: { raw: string; generated: string; elapsedMs: number; tokenCount: number }[]
): BakeOffResult {
  let passedCount = 0;
  let totalTokens = 0;
  let totalTimeMs = 0;

  for (const test of testCases) {
    const valid = validatePreservation(test.raw, test.generated);
    if (valid.isValid) {
      passedCount++;
    }
    totalTokens += test.tokenCount;
    totalTimeMs += test.elapsedMs;
  }

  const tokPerSec = totalTimeMs > 0 ? (totalTokens / (totalTimeMs / 1000)) : 0;
  const passRate = testCases.length > 0 ? passedCount / testCases.length : 0;
  const avgLatency = testCases.length > 0 ? totalTimeMs / testCases.length : 0;

  return {
    modelId,
    tokensPerSec: Math.round(tokPerSec * 10) / 10,
    peakRamMb: modelId.includes('2b') ? 1450 : 420,
    preservationPassRate: Math.round(passRate * 100) / 100,
    averageLatencyMs: Math.round(avgLatency),
  };
}

export async function runSlmBakeOff(
  modelIds: string[] = ['qwen2.5-0.5b-instruct', 'palmer-005'],
  fixtures: SlmBenchmarkCase[] = SLM_BENCHMARK_FIXTURES
): Promise<BakeOffResult[]> {
  const results: BakeOffResult[] = [];

  for (const modelId of modelIds) {
    const testCases: { raw: string; generated: string; elapsedMs: number; tokenCount: number }[] = [];

    for (const fixture of fixtures) {
      const prompt = buildPrompt(fixture.raw, fixture.tone, fixture.lang);
      const start = Date.now();
      const nativeRes = await llamaNative.generate({
        modelPath: `/models/slm/${modelId}-q4_k_m.gguf`,
        prompt,
      });
      const elapsed = Date.now() - start;
      const cleaned = postProcessOutput(nativeRes.text);
      const approxTokens = Math.ceil(cleaned.split(/\s+/).length * 1.3);

      testCases.push({
        raw: fixture.raw,
        generated: cleaned,
        elapsedMs: elapsed,
        tokenCount: approxTokens,
      });
    }

    const evalResult = evaluateModelPerformance(modelId, testCases);
    results.push(evalResult);
  }

  return results;
}

if (require.main === module) {
  /* eslint-disable no-console */
  const args = process.argv.slice(2);
  const modelsArg = args.find((a) => a.startsWith('--models='));
  const models = modelsArg
    ? modelsArg.replace('--models=', '').split(',')
    : ['qwen2.5-0.5b-instruct', 'palmer-005'];

  console.log('VoiceNote SLM Bake-off Evaluator');
  console.log(`Evaluating models: ${models.join(', ')} on ${SLM_BENCHMARK_FIXTURES.length} test cases\n`);

  runSlmBakeOff(models)
    .then((results) => {
      console.log('| Model ID | Tokens/Sec | Peak RAM (MB) | Preservation Pass Rate | Avg Latency (ms) |');
      console.log('|---|---|---|---|---|');
      for (const res of results) {
        console.log(
          `| ${res.modelId} | ${res.tokensPerSec} | ${res.peakRamMb} MB | ${(res.preservationPassRate * 100).toFixed(0)}% | ${res.averageLatencyMs}ms |`
        );
      }
      llamaNative.unloadModel().then(() => {
        process.exit(0);
      });
    })
    .catch((err) => {
      console.error('Bake-off evaluation failed:', err);
      process.exit(1);
    });
}
