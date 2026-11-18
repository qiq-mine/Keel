export function issueKey(issue) {
    return `${issue.projectId}:${issue.iid}`;
}
