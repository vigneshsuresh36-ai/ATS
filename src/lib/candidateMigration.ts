import { normalizeCandidateEmail, normalizeCandidatePhone } from "./candidateIdentity";

export type CandidateMigrationRecord = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
};

export type CandidateMigrationGroup = {
  key: string;
  records: CandidateMigrationRecord[];
};

export function buildCandidateMigrationGroups(records: CandidateMigrationRecord[]) {
  const grouped = new Map<string, CandidateMigrationRecord[]>();
  const groupForRecord = new Map<string, string>();
  for (const record of records) {
    const email = normalizeCandidateEmail(record.email);
    const phone = normalizeCandidatePhone(record.phone);
    const key = email && phone ? `contact:${email}:${phone}` : `legacy:${record.id}`;
    const group = grouped.get(key) || [];
    group.push(record);
    grouped.set(key, group);
    groupForRecord.set(record.id, key);
  }

  const contactGroups = new Map<string, Set<string>>();
  for (const record of records) {
    const groupKey = groupForRecord.get(record.id)!;
    for (const value of [
      normalizeCandidateEmail(record.email) ? `email:${normalizeCandidateEmail(record.email)}` : "",
      normalizeCandidatePhone(record.phone) ? `phone:${normalizeCandidatePhone(record.phone)}` : "",
    ].filter(Boolean)) {
      const groups = contactGroups.get(value) || new Set<string>();
      groups.add(groupKey);
      contactGroups.set(value, groups);
    }
  }

  const potentialDuplicatePairs = new Set<string>();
  for (const groups of contactGroups.values()) {
    const keys = [...groups].sort();
    for (let left = 0; left < keys.length; left += 1) {
      for (let right = left + 1; right < keys.length; right += 1) {
        potentialDuplicatePairs.add(`${keys[left]}\n${keys[right]}`);
      }
    }
  }

  return {
    groups: [...grouped].map(([key, group]) => ({ key, records: group.sort((left, right) => left.id.localeCompare(right.id)) })),
    potentialDuplicatePairs: [...potentialDuplicatePairs].map((pair) => pair.split("\n") as [string, string]),
  };
}