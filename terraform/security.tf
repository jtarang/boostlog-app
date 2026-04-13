resource "aws_security_group" "web" {
  name        = "boostlog-web-sg-${var.environment}"
  description = "Security group for Boostlog web server"
  vpc_id      = aws_vpc.main.id

  # No ingress rules needed! 
  # Cloudflare Tunnel and AWS SSM both operate via outbound (egress) connections.

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "boostlog-web-sg-${var.environment}"
  }
}
