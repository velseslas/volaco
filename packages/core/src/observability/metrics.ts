export interface MetricsSummary {
  totalRequests: number;
  successCount: number;
  clientErrorCount: number;
  serverErrorCount: number;
  avgLatencyMs: number;
  uptimeSeconds: number;
  timestamp: string;
}

export class MetricsCollector {
  private totalRequests = 0;
  private successCount = 0;
  private clientErrorCount = 0;
  private serverErrorCount = 0;
  private totalLatencyMs = 0;
  private startTime = Date.now();

  public recordRequest(statusCode: number, durationMs: number): void {
    this.totalRequests++;
    this.totalLatencyMs += durationMs;

    if (statusCode >= 200 && statusCode < 400) {
      this.successCount++;
    } else if (statusCode >= 400 && statusCode < 500) {
      this.clientErrorCount++;
    } else if (statusCode >= 500) {
      this.serverErrorCount++;
    }
  }

  public getMetricsSummary(): MetricsSummary {
    const avgLatencyMs = this.totalRequests > 0
      ? Math.round((this.totalLatencyMs / this.totalRequests) * 100) / 100
      : 0;

    return {
      totalRequests: this.totalRequests,
      successCount: this.successCount,
      clientErrorCount: this.clientErrorCount,
      serverErrorCount: this.serverErrorCount,
      avgLatencyMs,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString()
    };
  }

  public clear(): void {
    this.totalRequests = 0;
    this.successCount = 0;
    this.clientErrorCount = 0;
    this.serverErrorCount = 0;
    this.totalLatencyMs = 0;
    this.startTime = Date.now();
  }
}

export const metricsCollector = new MetricsCollector();
