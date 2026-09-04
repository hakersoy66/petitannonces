export type TrustScoreInput = {
  verified: boolean;
  reviewCount: number;
  reviewAverage: number | null;
  completedSales: number;
  memberSince: Date;
};

export type TrustScore = {
  score: number;
  reliableSeller: boolean;
  level: "NEW" | "ESTABLISHED" | "TRUSTED";
};

export function calculateTrustScore(input: TrustScoreInput): TrustScore {
  const ageMonths = Math.max(0, (Date.now() - input.memberSince.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  const verificationPoints = input.verified ? 20 : 0;
  const salesPoints = Math.min(input.completedSales / 10, 1) * 25;
  const agePoints = Math.min(ageMonths / 12, 1) * 10;
  const reviewConfidence = Math.min(input.reviewCount / 5, 1);
  const reviewPoints = input.reviewAverage === null ? 0 : (Math.max(0, Math.min(5, input.reviewAverage)) / 5) * 45 * reviewConfidence;
  const score = Math.round(Math.max(0, Math.min(100, verificationPoints + salesPoints + agePoints + reviewPoints)));
  const reliableSeller = score >= 75 && input.completedSales >= 3 && input.reviewCount >= 3 && (input.reviewAverage ?? 0) >= 4.3;
  return { score, reliableSeller, level: reliableSeller ? "TRUSTED" : score >= 50 ? "ESTABLISHED" : "NEW" };
}
