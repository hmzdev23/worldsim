import { ChatsCircle } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { SatirePost } from "../lib/scenario";

/** Fictional reactions from invented entities, newest first. Never real people or organizations. */
export function SocialFeed({ posts, loading }: { posts: SatirePost[]; loading: boolean }) {
  const reducedMotion = useReducedMotion();
  return (
    <section className="social-feed" aria-labelledby="social-feed-title">
      <div className="inspector-heading">
        <h2 id="social-feed-title"><ChatsCircle size={16} aria-hidden="true" /> Reactions</h2>
        <span className="inspector-meta satire-stamp">Fictional posts</span>
      </div>
      {posts.length === 0 ? (
        <p className="inspector-empty">{loading ? "Loading reactions…" : "No reactions yet. Invented officials and brands react as events land."}</p>
      ) : (
        <ul className="social-list">
          <AnimatePresence initial={false}>
            {posts.map((post) => (
              <motion.li
                key={post.id}
                layout={!reducedMotion}
                initial={reducedMotion ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.18 }}
                className="social-post"
                data-kind={post.kind}
              >
                <span className="social-avatar" aria-hidden="true">{post.author.charAt(0)}</span>
                <div>
                  <p className="social-who">
                    <strong>{post.author}</strong> <span>{post.handle}</span>
                    <span className="social-label">{post.label}</span>
                  </p>
                  <p className="social-text">{post.text}</p>
                  <p className="social-time">{post.sim_time_label}</p>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
