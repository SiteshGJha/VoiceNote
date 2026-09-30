import { AudioSegment } from './chunkedRecorder';

export type SegmentProcessor = (segment: AudioSegment) => Promise<string>;

interface QueueItem {
  segment: AudioSegment;
  processor: SegmentProcessor;
  resolve: (transcript: string) => void;
  reject: (err: unknown) => void;
}

/**
 * Sequential FIFO queue for transcribing audio segments one at a time.
 * Keeps memory low and respects the < 500MB peak memory budget.
 */
export class SegmentQueue {
  private queue: QueueItem[] = [];
  private isProcessing: boolean = false;
  private transcripts: string[] = [];

  public enqueue(segment: AudioSegment, processor: SegmentProcessor): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.queue.push({
        segment,
        processor,
        resolve,
        reject,
      });

      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift();

    if (!item) {
      this.isProcessing = false;
      return;
    }

    try {
      const text = await item.processor(item.segment);
      this.transcripts.push(text);
      item.resolve(text);
    } catch (err) {
      item.reject(err);
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }

  /**
   * Waits for all in-flight and enqueued items to complete, returning all transcripts in order.
   */
  public async flush(): Promise<string[]> {
    while (this.isProcessing || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return [...this.transcripts];
  }

  public getTranscripts(): string[] {
    return [...this.transcripts];
  }

  public clear(): void {
    this.queue = [];
    this.transcripts = [];
    this.isProcessing = false;
  }
}
