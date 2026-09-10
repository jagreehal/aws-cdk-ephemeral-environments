const MARKER = '<!-- ephemeral-env -->';

/**
 * Create the PR's environment comment, or edit the one already there.
 *
 * A comment per push would bury the review under a stack of near-identical links, and a stale one
 * would advertise a URL that no longer resolves — so both the deploy and the cleanup job write
 * through here, matching on the marker the body starts with.
 */
module.exports = async ({ github, context, body }) => {
  const issue_number = context.payload.pull_request?.number;

  if (!issue_number) {
    return;
  }

  const { owner, repo } = context.repo;
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number,
  });
  const existing = comments.find((comment) => comment.body?.startsWith(MARKER));

  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    return;
  }

  await github.rest.issues.createComment({ owner, repo, issue_number, body });
};
