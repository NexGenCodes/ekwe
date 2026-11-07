import { Link } from "react-router";
import { siteConfig } from "../data/siteConfig";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span className="footer-text">
          &copy; {year} {siteConfig.legal.companyName}. All rights reserved.
        </span>
        <ul className="footer-links">
          <li>
            <Link to="/privacy">Privacy</Link>
          </li>
          <li>
            <Link to="/terms">Terms</Link>
          </li>
          <li>
            <Link to="/changelog">Changelog</Link>
          </li>
          <li>
            <a href={`mailto:${siteConfig.contact.email}`}>Support</a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
