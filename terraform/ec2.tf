
# Fetch the latest Debian AMI ID from SSM Parameter Store
data "aws_ssm_parameter" "selected_ami" {
  name = var.ec2_ami_ssm_parameter
}

resource "aws_instance" "web" {
  ami                    = data.aws_ssm_parameter.selected_ami.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_profile.name
  key_name               = var.key_name

  instance_market_options {
    market_type = "spot"
    spot_options {
      spot_instance_type             = "one-time"
      instance_interruption_behavior = "terminate"
    }
  }

  user_data_replace_on_change = true

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  user_data = <<-EOF
              #!/bin/bash
              # Wait for any background apt processes to finish (prevents lock errors)
              while fuser /var/lib/dpkg/lock >/dev/null 2>&1 ; do
                  echo "Waiting for other software managers to finish..."
                  sleep 5
              done

              # Retry apt-get update if it fails (handles temporary repo issues)
              for i in {1..5}; do
                  apt-get update -y && break || sleep 10
              done

              # Install essential tools
              apt-get install -y ca-certificates curl gnupg lsb-release wget unzip jq

              # Setup 8GB Swap File to support large LLM models in memory
              fallocate -l 8G /swapfile
              chmod 600 /swapfile
              mkswap /swapfile
              swapon /swapfile
              echo "/swapfile swap swap defaults 0 0" >> /etc/fstab
              
              # Install AWS CLI
              curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
              unzip awscliv2.zip
              ./aws/install
              rm -rf aws awscliv2.zip

              # Install SSM Agent (Required for Debian/Ubuntu OIDC/SSM access)
              mkdir -p /tmp/ssm
              cd /tmp/ssm
              wget https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/debian_amd64/amazon-ssm-agent.deb
              dpkg -i amazon-ssm-agent.deb
              systemctl enable amazon-ssm-agent
              systemctl start amazon-ssm-agent
              cd -

              # Docker Installation
              mkdir -p /etc/apt/keyrings
              curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
              echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
              apt-get update -y
              apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
              systemctl enable docker
              systemctl start docker
              
              # Pull the docker-compose binary just in case it's not mapped well via plugin for backward compatibility
              curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
              chmod +x /usr/local/bin/docker-compose
              
              # Wait for the persistent EBS Volume to be attached by Terraform
              echo "Waiting for EBS volume to attach..."
              while [ ! -b /dev/nvme1n1 ] && [ ! -b /dev/sdf ] && [ ! -b /dev/xvdf ]; do
                  sleep 2
              done

              # Identify the device name (NVMe or standard)
              DEVICE=$(ls /dev/nvme1n1 2>/dev/null || ls /dev/sdf 2>/dev/null || ls /dev/xvdf 2>/dev/null)

              # Format the volume with ext4 if it doesn't already have a filesystem
              if ! blkid $DEVICE | grep -q "ext4"; then
                  echo "Formatting new EBS volume..."
                  mkfs.ext4 $DEVICE
              fi

              # Mount the persistent volume to our targeted data directory
              mkdir -p /app/data
              mount $DEVICE /app/data

              # Ensure it mounts automatically on future reboots
              echo "$DEVICE /app/data ext4 defaults,nofail 0 2" >> /etc/fstab

              # Set ownership to appuser (UID 1000) for Docker configuration
              chown -R 1000:1000 /app/data
              chmod 755 /app/data
              EOF

  tags = {
    Name = "boostlog-web-${var.environment}"
  }
}

resource "aws_eip" "web_eip" {
  instance = aws_instance.web.id
  domain   = "vpc"

  tags = {
    Name = "boostlog-eip-${var.environment}"
  }
}

resource "aws_ebs_volume" "data_volume" {
  availability_zone = aws_instance.web.availability_zone
  size              = 10 # 10GB for Postgres and uploads
  type              = "gp3"

  tags = {
    Name = "boostlog-data-${var.environment}"
  }
}

resource "aws_volume_attachment" "ebs_att" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data_volume.id
  instance_id = aws_instance.web.id
}
