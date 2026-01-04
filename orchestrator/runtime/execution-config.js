export const executionConfig = {
  autoApprove: {
    enabled: true,
    batchSize: 10,        // kolik kroků proběhne bez dotazu
    maxBatchSize: 50      // hard limit, ochrana
  }
};
